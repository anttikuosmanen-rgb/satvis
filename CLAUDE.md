# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
SatVis is a satellite orbit visualization web application built with Vue.js and CesiumJS. It calculates satellite positions from TLE (Two-Line Element) data, displays orbits on a 3D globe, and provides pass prediction for ground stations. The application runs as a Progressive Web App (PWA) with offline capabilities.

## Development Commands

### Build & Development
- `npm run start` - Start development server with webpack-dev-server
- `npm run start:anyhost` - Start dev server accessible from any host (0.0.0.0)
- `npm run build` - Production build (output in `dist/`)
- `npm run build:dev` - Development build
- `npm run serve` - Build and serve with static HTTP server
- `npm run serve:dev` - Build dev version and serve

### Code Quality
- `npm run lint` - Run ESLint on JavaScript and Vue files in src/
- `npm run lint:fix` - Run ESLint with auto-fix

### Data Updates
- `npm run update-tle` - Fetch latest TLE data from NORAD
- `npm run update-custom-data` - Update both TLE and custom satellite data

### Setup
Initialize git submodules before development:
```bash
git submodule update --init
npm clean-install
```

## Architecture

### Core Technologies
- **Vue.js 3** with Composition API and Pinia for state management
- **CesiumJS** for 3D globe visualization and satellite rendering
- **Satellite.js** for orbital mechanics calculations
- **Workbox** for PWA/service worker functionality
- **PrimeVue** for UI components with Aura theme

### Key Application Structure

#### Main Entry Points
- `src/app.js` - Main application setup and configuration
- `src/index.js` - Entry point for standard app
- `src/move.js` / `src/ot.js` - Specialized entry points for custom builds

#### Core Controllers
- `src/modules/CesiumController.js` - Central Cesium viewer management, handles 3D scene setup, imagery layers, and performance optimization
- `src/modules/SatelliteManager.js` - Satellite lifecycle management, TLE processing, and orbit calculations
- `src/components/VueCesiumController.js` - Vue integration layer for Cesium

#### State Management (Pinia stores)
- `src/stores/cesium.js` - Cesium viewer state, camera settings, and scene configuration
- `src/stores/sat.js` - Satellite data, selection state, and tracking preferences

#### Key Components
- `src/components/Satvis.vue` - Main satellite visualization component
- `src/components/SatelliteSelect.vue` - Satellite selection interface

#### Utility Modules
- `src/modules/util/pinia-plugin-url-sync.ts` - URL state synchronization
- `src/modules/util/PushManager.js` - Browser notification handling
- `src/modules/util/CesiumPerformanceStats.js` - Performance monitoring
- `src/modules/Orbit.js` - Orbital mechanics and trajectory calculations
- `src/modules/GroundStationEntity.js` - Ground station visualization

### Data Structure
- `data/tle/` - TLE (Two-Line Element) files for satellite orbital data
- `data/custom/` - Custom satellite configurations and scripts
- `data/cesium-assets/` - Offline imagery tiles for Cesium
- `src/assets/` - Static assets including PWA icons and manifests

### Build Configuration
The project uses Webpack with multiple configuration files:
- `webpack/webpack.config.js` - Development configuration
- `webpack/webpack.prod.js` - Production configuration
- `webpack/webpack.stats.js` - Bundle analysis configuration

### Testing
Tests are located in `src/test/` but appear to be disabled. The project currently has:
- `src/test/Orbit.test.js.disabled` - Orbital mechanics tests (disabled)
- `src/test/benchmark.js` - Performance benchmarking
- `src/test/test.js` - General test utilities

### Device & Platform Support
The application detects iOS devices and iframe embedding to adjust UI accordingly (minimal UI mode). Service worker registration is disabled on localhost for development.

### Key Technical Notes
- Uses TypeScript configuration but primarily JavaScript codebase
- Supports offline operation through service worker and cached imagery
- Implements custom Cesium imagery providers for offline tile serving
- Uses Sentry for error tracking in production (satvis.space domain)
- State synchronization between URL parameters and Pinia stores for bookmarkable views
- restart dev server
- use SSH key ~/.ssh/anttis-github-key for github.com%
