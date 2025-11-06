# TLE Constellation Generator Tool

## Overview

`generate-constellation.cjs` is a command-line tool that creates evenly-spaced satellite constellations from a single TLE (Two-Line Element Set). It works by adjusting the Mean Anomaly parameter to position satellites at regular intervals around the same orbit.

## Quick Start

```bash
# Generate 4 satellites evenly spaced (90° apart)
node generate-constellation.cjs 4 "1 39634U ..." "2 39634 ..."

# Generate from a TLE file
node generate-constellation.cjs 6 input.tle > constellation.tle

# Generate with custom name
node generate-constellation.cjs 3 "My Constellation" "1 39634U ..." "2 39634 ..."
```

## Features

- ✅ **Automatic checksum calculation** - Generates valid TLEs that work with all parsers
- ✅ **Satellite numbering** - Auto-increments satellite numbers (39634 → 39635 → 39636)
- ✅ **International designators** - Auto-increments letter suffix (14016A → 14016B → 14016C)
- ✅ **Phase angle names** - Appends degree offset to names ("+60°", "+120°", etc.)
- ✅ **File or direct input** - Accepts TLE files or direct command-line arguments
- ✅ **3-line format support** - Handles both 2-line and 3-line (with name) TLE formats

## How It Works

The Mean Anomaly (MA) in a TLE represents the satellite's position along its orbit:
- 0° = perigee (closest point to Earth)
- 90° = one quarter orbit
- 180° = apogee (farthest point from Earth)
- 270° = three quarters orbit

For N satellites, each is spaced 360°/N apart:

| Satellites | Spacing | Satellites | Spacing |
|------------|---------|------------|---------|
| 2 | 180° | 8 | 45° |
| 3 | 120° | 12 | 30° |
| 4 | 90° | 24 | 15° |
| 6 | 60° | 36 | 10° |

## Usage Examples

### Example 1: Binary Constellation (2 satellites, 180° apart)

```bash
node generate-constellation.cjs 2 \
  "1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993" \
  "2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266" \
  2>/dev/null
```

Output:
```
Satellite
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9994
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615260
Satellite +180°
1 39635U 14016B   25294.87619147  .00000382  00000+0  90745-4 0  9995
2 39635  98.1822 300.8762 0001320  89.7975  90.3376 14.59200968615261
```

### Example 2: From TLE File

**input.tle:**
```
Double Sentinel
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266
```

```bash
node generate-constellation.cjs 4 input.tle 2>/dev/null > 4-sat-constellation.tle
```

### Example 3: Global Coverage Constellation

```bash
# Generate 12 satellites for enhanced global coverage
node generate-constellation.cjs 12 "GlobalSat" \
  "1 25544U 98067A   25294.50000000  .00016717  00000+0  10270-3 0  9000" \
  "2 25544  51.6400  10.0000 0001000   0.0000 270.0000 15.50000000999999" \
  2>/dev/null > global-constellation.tle
```

## File Format Support

### 2-Line TLE Format
```
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266
```

### 3-Line TLE Format (with name)
```
Double Sentinel
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266
```

Both formats are auto-detected and handled correctly.

## Output Format

Output is always in 3-line format (name + TLE):
```
<Satellite Name>
1 <Line 1 with checksum>
2 <Line 2 with checksum>
<Satellite Name> +<degrees>°
1 <Line 1 with checksum>
2 <Line 2 with checksum>
...
```

Status messages are printed to stderr, TLE data to stdout. Use `2>/dev/null` to suppress status messages when redirecting output.

## Integration with Satvis

1. Generate a constellation:
   ```bash
   node generate-constellation.cjs 6 input.tle 2>/dev/null > data/tle/groups/my-constellation.txt
   ```

2. The file automatically appears in Satvis under TLE groups

3. Load it in the application to visualize

4. Use Smart Path mode to see visibility patterns from ground stations

## Technical Details

### What Gets Modified

For each satellite:
1. **Satellite Number** - Incremented (39634 → 39635 → 39636 → ...)
2. **International Designator** - Letter incremented (14016A → 14016B → 14016C → ...)
3. **Mean Anomaly** - Adjusted by 360°/N per satellite
4. **Checksums** - Recalculated for both lines
5. **Name** - Appended with phase angle ("+120°")

### What Stays the Same

All other orbital parameters are preserved:
- Inclination
- Right Ascension of Ascending Node (RAAN)
- Eccentricity
- Argument of Perigee
- Mean Motion
- Epoch

This ensures all satellites share the exact same orbital plane.

### Checksum Algorithm

The TLE checksum is calculated as:
```
checksum = (sum of all digits + count of minus signs) mod 10
```

Example:
```
Line: "1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  999"
Digits: 3,9,6,3,4,1,4,0,1,6,2,5,2,9,4,8,7,6,1,9,1,4,7,0,0,0,0,0,3,8,2,0,0,0,0,0,0,9,0,7,4,5,4,0,9,9,9
Minus signs: 1 (in "90745-4")
Sum: 246 + 1 = 247
Checksum: 247 mod 10 = 7
```

## Common Use Cases

### 1. Walker Constellation
Generate evenly-spaced satellites in a single orbital plane:
```bash
node generate-constellation.cjs 24 walker-plane-1.tle > walker-24.tle
```

### 2. Opposing Pair
Create two satellites 180° apart for continuous coverage:
```bash
node generate-constellation.cjs 2 reference-sat.tle > opposing-pair.tle
```

### 3. Communication Relay
Build a network with 120° spacing for triangulation:
```bash
node generate-constellation.cjs 3 "Relay Network" base-tle.txt > relay-network.tle
```

### 4. Coverage Analysis
Test different constellation sizes for optimal coverage:
```bash
for n in 4 6 8 12 24; do
  node generate-constellation.cjs $n base.tle 2>/dev/null > "constellation-$n.tle"
done
```

## Limitations

- Satellite numbers wrap at 99999 (5-digit TLE limit)
- International designator letters wrap at 'Z'
- All satellites share the same orbital plane (same RAAN)
- For multi-plane constellations, run the tool multiple times with different input TLEs

## Validation

Verify generated TLEs:

```bash
# Check Mean Anomaly values
cat output.tle | grep "^2 " | awk '{print $7}'

# Verify satellite count
cat output.tle | grep "^1 " | wc -l

# Check satellite numbers sequence
cat output.tle | grep "^1 " | awk '{print $2}' | cut -c1-5
```

## Error Handling

The tool validates:
- Number of satellites is a positive integer
- TLE lines start with "1 " and "2 " respectively
- Input file exists and is readable
- TLE has at least 2 lines

Common errors:
```bash
# Error: missing arguments
node generate-constellation.cjs 4

# Error: invalid number
node generate-constellation.cjs abc input.tle

# Error: file not found
node generate-constellation.cjs 4 nonexistent.tle

# Error: invalid TLE format
node generate-constellation.cjs 4 "invalid" "format"
```

## Files

- `generate-constellation.cjs` - Main tool script
- `generate-constellation.md` - Detailed documentation
- `CONSTELLATION-QUICK-START.md` - Quick reference guide
- `data/tle/groups/constellation-example.txt` - Example 6-satellite constellation

## See Also

- [TLE Format Specification](https://en.wikipedia.org/wiki/Two-line_element_set)
- [Orbital Elements](https://en.wikipedia.org/wiki/Orbital_elements)
- [Walker Constellation](https://en.wikipedia.org/wiki/Satellite_constellation#Walker_constellation)
- [Mean Anomaly](https://en.wikipedia.org/wiki/Mean_anomaly)
