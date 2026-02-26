import {
  BlendingState,
  BoundingSphere,
  Buffer,
  BufferUsage,
  Cartesian3,
  Color,
  ComponentDatatype,
  destroyObject,
  DrawCommand,
  Matrix4,
  Pass,
  PrimitiveType,
  RenderState,
  ShaderProgram,
  ShaderSource,
  VertexArray,
} from "@cesium/engine";

const vertexShaderSource = `
in vec3 position;
void main() {
    gl_Position = czm_modelViewProjection * vec4(position, 1.0);
    #ifdef LOG_DEPTH
    czm_vertexLogDepth();
    #endif
}
`;

const fragmentShaderSource = `
uniform vec4 u_color;
void main() {
    out_FragColor = u_color;
    #ifdef LOG_DEPTH
    czm_writeLogDepth();
    #endif
}
`;

/**
 * Custom CesiumJS primitive that renders orbit lines using GL_LINE_STRIP.
 * Bypasses all horizon/frustum culling (cull=false, occlude=false) so orbits
 * remain visible at extreme solar system distances (1500M+ km).
 *
 * Supports depth testing so arcs behind Earth/Moon/planets are properly hidden.
 */
export class OrbitLinePrimitive {
  /**
   * @param {Object} options
   * @param {Cartesian3[]} options.positions - Orbit sample positions in native frame
   * @param {Color} [options.color=Color.WHITE] - Line color
   * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] - Transform from native frame to ECEF
   * @param {boolean} [options.show=true] - Whether to show the primitive
   * @param {boolean} [options.depthTestEnabled=false] - Enable depth testing against Earth's globe and other geometry
   */
  constructor({ positions, color = Color.WHITE, modelMatrix = Matrix4.IDENTITY, show = true, depthTestEnabled = false, minDistance = 0, fadeRange = 0.2 }) {
    this._positions = positions;
    this._color = Color.clone(color);
    this._baseAlpha = color.alpha;
    this._renderColor = Color.clone(color); // Mutable copy for per-frame alpha adjustment
    this._modelMatrix = Matrix4.clone(modelMatrix);
    this._depthTestEnabled = depthTestEnabled;
    this._minDistance = minDistance;
    this._fadeRange = fadeRange; // Fraction of minDistance over which to fade in (0.2 = 20%)
    this._wasFading = minDistance > 0; // Start as fading if we have a minDistance
    this.show = show;

    this._vertexArray = undefined;
    this._shaderProgram = undefined;
    this._renderState = undefined;
    this._drawCommand = undefined;
    this._boundingSphere = undefined;
    this._dirty = true;
  }

  get modelMatrix() {
    return this._modelMatrix;
  }

  set modelMatrix(value) {
    Matrix4.clone(value, this._modelMatrix);
    if (this._drawCommand) {
      this._drawCommand.modelMatrix = this._modelMatrix;
      // Update bounding sphere in world space
      BoundingSphere.transform(this._localBoundingSphere, this._modelMatrix, this._boundingSphere);
      this._drawCommand.boundingVolume = this._boundingSphere;
    }
  }

  /**
   * Replace vertex positions (e.g. when orbit needs re-sampling).
   * @param {Cartesian3[]} positions
   */
  updatePositions(positions) {
    this._positions = positions;
    this._dirty = true;
  }

  /**
   * Called by CesiumJS each frame. Pushes DrawCommand to the command list.
   * @param {Object} frameState
   */
  update(frameState) {
    if (!this.show || this._positions.length < 2) {
      return;
    }

    if (this._minDistance > 0) {
      const cameraDist = Cartesian3.magnitude(frameState.camera.positionWC);
      if (cameraDist < this._minDistance) {
        return;
      }
      // Fade in over the fade range beyond minDistance
      const fadeEnd = this._minDistance * (1 + this._fadeRange);
      const t = Math.min((cameraDist - this._minDistance) / (fadeEnd - this._minDistance), 1.0);
      const fading = t < 1.0;
      this._renderColor.alpha = fading ? this._baseAlpha * t : this._baseAlpha;
      // Switch between translucent (fading) and opaque (fully visible) pass
      if (fading !== this._wasFading) {
        this._wasFading = fading;
        this._dirty = true;
      }
    }

    if (this._dirty || !this._drawCommand) {
      this._createResources(frameState.context);
      this._dirty = false;
    }

    frameState.commandList.push(this._drawCommand);
  }

  /**
   * Create GPU resources: vertex buffer, shaders, render state, draw command.
   * @param {Object} context - CesiumJS rendering context
   */
  _createResources(context) {
    // Clean up previous resources
    if (this._vertexArray) {
      this._vertexArray.destroy();
    }
    if (this._shaderProgram && !this._shaderProgram.isDestroyed()) {
      this._shaderProgram.destroy();
    }

    const numPositions = this._positions.length;

    // Build Float32 vertex data: [x, y, z, x, y, z, ...]
    const vertexData = new Float32Array(numPositions * 3);
    for (let i = 0; i < numPositions; i++) {
      const p = this._positions[i];
      vertexData[i * 3] = p.x;
      vertexData[i * 3 + 1] = p.y;
      vertexData[i * 3 + 2] = p.z;
    }

    const vertexBuffer = Buffer.createVertexBuffer({
      context,
      typedArray: vertexData,
      usage: BufferUsage.STATIC_DRAW,
    });

    this._vertexArray = new VertexArray({
      context,
      attributes: [
        {
          index: 0,
          vertexBuffer,
          componentsPerAttribute: 3,
          componentDatatype: ComponentDatatype.FLOAT,
        },
      ],
    });

    this._shaderProgram = ShaderProgram.fromCache({
      context,
      vertexShaderSource: new ShaderSource({
        sources: [vertexShaderSource],
      }),
      fragmentShaderSource: new ShaderSource({
        sources: [fragmentShaderSource],
      }),
      attributeLocations: {
        position: 0,
      },
    });

    const useBlending = this._wasFading === true;
    this._renderState = RenderState.fromCache({
      depthTest: { enabled: this._depthTestEnabled },
      depthMask: false,
      ...(useBlending ? { blending: BlendingState.ALPHA_BLEND } : {}),
    });

    // Compute bounding sphere in local frame
    this._localBoundingSphere = BoundingSphere.fromPoints(this._positions);
    this._boundingSphere = BoundingSphere.transform(this._localBoundingSphere, this._modelMatrix, new BoundingSphere());

    const renderColor = this._renderColor;

    this._drawCommand = new DrawCommand({
      vertexArray: this._vertexArray,
      shaderProgram: this._shaderProgram,
      renderState: this._renderState,
      primitiveType: PrimitiveType.LINE_STRIP,
      modelMatrix: this._modelMatrix,
      boundingVolume: this._boundingSphere,
      cull: false,
      occlude: false,
      pass: useBlending ? Pass.TRANSLUCENT : Pass.OPAQUE,
      uniformMap: {
        u_color: () => renderColor,
      },
    });
  }

  /**
   * Returns true if this object has been destroyed.
   */
  isDestroyed() {
    return false;
  }

  /**
   * Clean up GPU resources.
   */
  destroy() {
    if (this._vertexArray) {
      this._vertexArray.destroy();
    }
    if (this._shaderProgram && !this._shaderProgram.isDestroyed()) {
      this._shaderProgram.destroy();
    }
    return destroyObject(this);
  }
}
