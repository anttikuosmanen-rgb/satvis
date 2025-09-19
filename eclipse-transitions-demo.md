# Eclipse Transition Times Feature Demo

## Overview
The SatVis application now displays specific times when satellites transition between eclipse and sunlight during passes, providing precise timing for optimal observation and photography.

## Enhanced Features

### 1. Satellite Passes Panel
The passes panel now shows detailed eclipse transition information:

```
📡 Satellite Passes

ISS - 2024-01-15 18:30:45 (8m 45s)
Max elevation: 72.5°
Start: 45° (NE) | End: 225° (SW)

Ground:    🌙 → ☀️
Satellite: ☀️ → 🌑 → ☀️ (2 transitions)

Eclipse Transitions:
🌑 18:35:12  enters eclipse
☀️ 18:37:28  exits eclipse
```

### 2. Enhanced Pass Tables
All satellite pass tables now include a dedicated "Eclipse Transitions" column:

| Name | Countdown | Start      | End      | El  | Az   | Ground | Satellite | Eclipse Transitions |
|------|-----------|------------|----------|-----|------|--------|-----------|-------------------|
| ISS  | 02:15:30  | 15 18:30:45| 18:39:30 | 72° | 135° | 🌙→☀️  | ☀️→🌑    | 18:35:12 🌑<br>18:37:28 ☀️ |

### 3. Rich Tooltips
Hovering over satellite illumination indicators shows:
- **Detailed transition times** with precise timestamps
- **Direction indicators**: →🌑 (enters eclipse) / →☀️ (exits eclipse)
- **Complete timeline** of eclipse events during the pass

Example tooltip:
```
Satellite illumination: Sunlit → Eclipse (2 transitions)
- Transitions: 18:35:12 →🌑 (enters eclipse), 18:37:28 →☀️ (exits eclipse)
```

## Technical Implementation

### Eclipse Transition Detection
- **30-second resolution** for transition timing accuracy
- **Geometric shadow model** using Earth's umbra calculations
- **Real-time calculation** during pass computation
- **Transition classification**: Shadow entry vs. shadow exit

### Display Enhancements
- **Visual timeline** in passes panel with styled transition boxes
- **Dedicated table column** for transition times in all pass tables
- **Icon indicators**: 🌑 for shadow entry, ☀️ for shadow exit
- **Time formatting**: Local time display with seconds precision

### UI Components
- **Transition times box**: Highlighted section with blue border
- **Individual transitions**: Icon + time + description per line
- **Responsive design**: Scales properly on different screen sizes
- **Color coding**: Eclipse (dark) vs. Sunlit (bright) visual themes

## Usage Applications

### 1. Astrophotography Planning
- **Golden moments**: Time exact eclipse entry/exit for dramatic shots
- **Multi-exposure sequences**: Plan shots around transition events
- **ISS photography**: Capture illuminated station against dark sky

### 2. Scientific Observation
- **Thermal analysis**: Monitor satellite temperature changes during eclipse
- **Power systems**: Study solar panel performance during shadow periods
- **Orbital mechanics**: Validate eclipse prediction models

### 3. Amateur Radio Operations
- **Signal strength**: Anticipate power changes affecting transponders
- **Battery monitoring**: Track satellite power consumption patterns
- **Communication windows**: Plan contacts around power availability

### 4. Educational Applications
- **Eclipse demonstration**: Show real-time shadow geometry
- **Orbital mechanics**: Visualize Earth's shadow interaction with satellites
- **Astronomy education**: Teach eclipse concepts with live examples

## Example Scenarios

### Scenario 1: ISS Eclipse Photography
```
ISS Pass - Evening Twilight
Ground: 🌙 Dark (perfect for observation)
Satellite: ☀️→🌑→☀️ (enters eclipse mid-pass)

18:35:12 🌑 ISS enters Earth's shadow
         ↳ Perfect time for eclipse entry shot
18:37:28 ☀️ ISS exits Earth's shadow
         ↳ Dramatic illumination moment
```

### Scenario 2: Science Mission Analysis
```
Satellite XYZ - Research Pass
Multiple transitions for power analysis:

14:22:15 🌑 enters eclipse (power to batteries)
14:24:33 ☀️ exits eclipse (solar panels active)
14:28:45 🌑 enters eclipse (second shadow period)
14:31:12 ☀️ exits eclipse (full illumination)
```

## Benefits

### For Observers
- **Perfect timing** for eclipse photography opportunities
- **Anticipate visibility** changes during passes
- **Plan equipment settings** around illumination changes

### For Scientists
- **Precise timing** for correlating observations with eclipse events
- **Power system analysis** during shadow periods
- **Thermal modeling** validation with real transition times

### For Educators
- **Real-world examples** of orbital mechanics
- **Visual demonstration** of eclipse geometry
- **Interactive learning** with live satellite data

The eclipse transition times feature transforms SatVis from a basic tracking tool into a professional-grade satellite observation platform, providing the precise timing information needed for scientific, educational, and recreational satellite activities.