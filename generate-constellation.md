# TLE Constellation Generator

A command-line tool that generates a constellation of satellites on the same orbit at evenly spaced intervals.

## How It Works

The tool creates multiple TLEs (Two-Line Elements) from a single input TLE by modifying the **Mean Anomaly** parameter. The Mean Anomaly represents the satellite's position along its orbit (0-360°), so adjusting it creates satellites at different positions on the same orbital path.

For N satellites, each satellite is spaced 360°/N apart around the orbit.

## Usage

```bash
node generate-constellation.cjs <num-satellites> <tle-line1> <tle-line2>
node generate-constellation.cjs <num-satellites> <name> <tle-line1> <tle-line2>
node generate-constellation.cjs <num-satellites> <tle-file>
```

## Examples

### Example 1: Generate 4 satellites from direct TLE input

```bash
node generate-constellation.cjs 4 \
  "1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993" \
  "2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266"
```

Output:
```
Satellite
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9994
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615260
Satellite +90°
1 39635U 14016B   25294.87619147  .00000382  00000+0  90745-4 0  9995
2 39635  98.1822 300.8762 0001320  89.7975   0.3376 14.59200968615262
Satellite +180°
1 39636U 14016C   25294.87619147  .00000382  00000+0  90745-4 0  9996
2 39636  98.1822 300.8762 0001320  89.7975  90.3376 14.59200968615262
Satellite +270°
1 39637U 14016D   25294.87619147  .00000382  00000+0  90745-4 0  9997
2 39637  98.1822 300.8762 0001320  89.7975 180.3376 14.59200968615263
```

### Example 2: Generate 6 satellites with a custom name

```bash
node generate-constellation.cjs 6 "Double Sentinel" \
  "1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993" \
  "2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266"
```

Output:
```
Double Sentinel
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9994
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615260
Double Sentinel +60°
1 39635U 14016B   25294.87619147  .00000382  00000+0  90745-4 0  9995
2 39635  98.1822 300.8762 0001320  89.7975 330.3376 14.59200968615265
Double Sentinel +120°
1 39636U 14016C   25294.87619147  .00000382  00000+0  90745-4 0  9996
2 39636  98.1822 300.8762 0001320  89.7975  30.3376 14.59200968615265
...
```

### Example 3: Generate from a TLE file

```bash
node generate-constellation.cjs 3 input.tle
```

The TLE file can be in 2-line or 3-line format:

**2-line format:**
```
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266
```

**3-line format (with name):**
```
Double Sentinel
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266
```

### Example 4: Redirect output to a file

```bash
node generate-constellation.cjs 8 input.tle 2>/dev/null > constellation.tle
```

This generates 8 satellites and saves them to `constellation.tle`, suppressing status messages.

## What Gets Modified

For each satellite in the constellation, the tool modifies:

1. **Satellite Number** - Incremented by 1 for each satellite (e.g., 39634 → 39635 → 39636)
2. **International Designator** - The letter suffix is incremented (e.g., 14016A → 14016B → 14016C)
3. **Mean Anomaly** - Adjusted by 360°/N for each satellite to create even spacing
4. **Checksums** - Recalculated for both lines to ensure valid TLEs
5. **Satellite Name** - Appended with phase angle (e.g., "+120°") for identification

All other orbital parameters remain identical, ensuring satellites share the same orbital plane.

## Technical Details

### Mean Anomaly Calculation

For N satellites, the phase increment is:
```
phase_increment = 360° / N
```

Each satellite i (where i = 0 to N-1) gets a Mean Anomaly of:
```
MA[i] = (base_MA + i × phase_increment) mod 360
```

### TLE Checksum

The checksum is calculated as modulo 10 of the sum of:
- All numerical digits in the line
- +1 for each minus sign

This ensures the generated TLEs are valid and can be parsed by satellite tracking software.

## Use Cases

- **Satellite constellation design** - Visualize evenly-spaced orbital constellations
- **Coverage analysis** - Analyze global coverage patterns for constellation designs
- **Communication networks** - Model satellite relay networks with consistent orbital spacing
- **Testing** - Generate test data for satellite tracking applications

## Notes

- The tool preserves all orbital parameters except Mean Anomaly
- Generated TLEs have valid checksums and can be used with standard TLE parsers
- Satellite numbers wrap at 99999 (5-digit limit in TLE format)
- International designator letters wrap at 'Z'
- The first satellite (index 0) preserves the original Mean Anomaly
