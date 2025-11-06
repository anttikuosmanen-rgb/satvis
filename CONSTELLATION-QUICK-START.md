# Constellation Generator - Quick Start

## One-Line Examples

```bash
# Generate 4 satellites equally spaced (90° apart)
node generate-constellation.cjs 4 "1 39634U ..." "2 39634 ..." 2>/dev/null

# Generate 8 satellites from a file and save to new file
node generate-constellation.cjs 8 input.tle 2>/dev/null > constellation.tle

# Generate 6 satellites with custom name
node generate-constellation.cjs 6 "StarLink Clone" "1 39634U ..." "2 39634 ..." 2>/dev/null

# Generate 12 satellites for global coverage
node generate-constellation.cjs 12 tle-file.txt 2>/dev/null > 12-sat-constellation.tle
```

## Common Constellation Sizes

| Satellites | Spacing | Use Case |
|------------|---------|----------|
| 2 | 180° | Opposing satellites |
| 3 | 120° | Minimal coverage |
| 4 | 90° | Quadrature constellation |
| 6 | 60° | Enhanced coverage |
| 8 | 45° | High coverage |
| 12 | 30° | Very high coverage |
| 24 | 15° | GPS-like constellation (per plane) |

## Quick Validation

Check Mean Anomaly spacing:
```bash
cat output.tle | grep "^2 " | awk '{print $7}'
```

Count satellites generated:
```bash
cat output.tle | grep "^1 " | wc -l
```

## Integration with Satvis

1. Generate constellation:
   ```bash
   node generate-constellation.cjs 6 input.tle 2>/dev/null > data/tle/groups/my-constellation.txt
   ```

2. The file will automatically appear in the Satvis TLE groups

3. Load it in the application to visualize the constellation

## Tips

- Use `2>/dev/null` to suppress status messages when saving to file
- First satellite (index 0) keeps the original Mean Anomaly
- Satellite numbers and designators auto-increment
- All orbital parameters except Mean Anomaly remain identical
- Generated TLEs have valid checksums and work with all TLE parsers
