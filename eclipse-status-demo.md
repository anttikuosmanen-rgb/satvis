# Real-Time Satellite Eclipse Status Demo

## Overview
The SatVis application now displays real-time satellite eclipse/illumination status in multiple locations.

## Features Added

### 1. Satellite Position Table
The satellite info box now includes an "Illumination" column showing:
- **🌑 Eclipse** - Satellite is in Earth's shadow
- **☀️ Sunlit** - Satellite is illuminated by the Sun
- **—** - Status unavailable

### 2. Enhanced Satellite Passes Panel
The passes panel now shows both ground and satellite conditions:

```
Ground:    🌙 → ☀️  (Ground station lighting)
Satellite: ☀️ → 🌑  (Satellite illumination with eclipse transitions)
           (2 transitions)
```

### 3. Comprehensive Pass Tables
All pass tables (satellite, ground station, and passes panel) now display:
- **Ground Column**: 🌙 Dark / ☀️ Light
- **Satellite Column**: 🌑 Eclipse / ☀️ Sunlit
- **Transition Detection**: Shows number of eclipse transitions during pass

## Technical Implementation

### Eclipse Detection Algorithm
- Uses astronomy-engine for precise Sun position calculations
- Implements geometric shadow model with Earth's umbra
- Converts between coordinate systems (ECF ↔ ECI ↔ Ecliptic)
- Accounts for satellite position relative to Sun-Earth line

### Real-Time Updates
- Eclipse status calculated dynamically for current time
- Updates automatically as satellite moves through orbit
- Integrated with existing cached callback property system
- Graceful fallback if calculations fail

### Visual Indicators
- **🌑 Eclipse**: Dark blue/gray background
- **☀️ Sunlit**: Bright yellow background
- **Transition info**: Shows eclipse entry/exit events during passes
- **Tooltips**: Detailed illumination information on hover

## Benefits for Users
- **Complete awareness** of satellite illumination conditions
- **Eclipse timing** for photography and observation planning
- **Transition detection** for capturing shadow entry/exit events
- **Professional accuracy** using astronomical calculation libraries

## Usage Examples

### Optimal Observation Planning
- Look for passes where satellite is sunlit but ground station is dark
- Identify eclipse transitions for dramatic photography opportunities
- Plan ISS photography during optimal illumination conditions

### Scientific Applications
- Study satellite thermal behavior during eclipse/sunlit transitions
- Analyze power generation patterns for solar-powered satellites
- Monitor satellite operations during shadow periods

The real-time eclipse status provides comprehensive situational awareness for both casual observers and professional satellite operators.