# SatVis - Enhanced Fork ![Node CI](https://github.com/anttikuosmanen-rgb/satvis/workflows/Node%20CI/badge.svg) ![Deploy](https://github.com/anttikuosmanen-rgb/satvis/workflows/Deploy%20to%20GitHub%20Pages/badge.svg)

Satellite orbit visualization and pass prediction with enhanced features for visual observing of satellites.

> [!NOTE]
> This is an enhanced fork of [Flowm/satvis](https://github.com/Flowm/satvis) with significant improvements to pass prediction, timeline visualization, and ground station features.
>
> **Live Demo:** [https://anttikuosmanen-rgb.github.io/satvis/](https://anttikuosmanen-rgb.github.io/satvis/)
>
> **Active Branch:** `master` contains the latest improvements and is automatically deployed to GitHub Pages.

![Screenshot](https://anttikuosmanen-rgb.github.io/satvis/data/images/screenshot.png)

## Keyboard Shortcuts

### Menu Navigation
- `s` - Open satellite selection menu
- `Shift+S` - Open satellite visuals menu
- `g` - Open ground station menu
- `l` - Open map layers menu
- `Shift+D` - Open debug menu
- `↑` `↓` - Navigate menu items
- `Enter` - Activate/toggle selected item
- `Esc` - Close menu, info box, or reset to globe view when tracking

### View & Navigation
- `Space` - Toggle between satellite and ground station view (preserves camera position)
- `Shift+T` - Track selected entity (camera follows it)
- `i` - Show info box for tracked entity
- `o` - Toggle orbit track (double-tap for Smart Path)
- `z` - Flip camera to opposite side of globe
- `Double-click GS button` - Toggle ground station focus

### Time Controls
- `t` - Set to real time (current time at 1x speed)
- `1-9, 0` - Time acceleration (1x, 2x, 4x, 8x... 1024x)
- `Shift+1-9, 0` - Negative time acceleration (reverse)
- `,` - Jump backward 1 hour
- `.` - Jump forward 1 hour
- `;` or `<` - Jump backward 24 hours
- `:` or `>` - Jump forward 24 hours

## Features
- Calculate position and orbit of satellites from TLE
- Set groundstation through geolocation or pick on map
- Calculate passes for a set groundstation
- Local browser notifications for passes
- Serverless architecture
- Works offline as Progressive Web App (PWA)

## Enhanced Features in This Fork

### Zenith View
Ground-level sky viewing from your ground station location with sky-up camera perspective. Watch satellites move across the sky as they would appear during passes. Toggle between normal 3D globe and zenith view modes.

### Pass Prediction & Visualization
- **Smart Pass Calculations** - Optimized caching and chunked processing with automatic cache invalidation
- **Eclipse Tracking** - Display satellite illumination transitions during passes with precise timing
- **Timeline Highlights** - Visual markers for satellite passes and ground station daylight periods
- **Pass Filtering** - Filter by sunlight conditions (hide sunlit passes, show only lit satellite passes)
- **Local Time Support** - Ground station timezone display alongside UTC
- **Click Navigation** - Click pass cards in info panel to jump to pass start time
- **Polar Coordinates** - Proper daytime calculation and caching for polar regions
- **GEO Satellites** - Continuous visibility display for geostationary satellites
- **Pre-launch Support** - Dedicated group for upcoming launches with epoch-based filtering

### Keyboard Navigation
Full keyboard control with shortcuts for all menus and functions. Arrow keys navigate menu items, Enter activates, ESC closes menus/info boxes or resets to globe view when tracking. Time acceleration with number keys (1-9, 0 for 1x to 1024x, Shift for reverse). Spacebar toggles satellite/ground station views with camera position persistence. Shift+T tracks selected entity. Z key flips camera to opposite side of globe. Shortcuts displayed in tooltips.

### Timeline Controls
- **Zoom Controls** - Plus/minus buttons with smooth 0.75x/1.33x zoom steps
- **Zoom Preservation** - Maintains zoom level during time navigation and pass jumps
- **Improved Bounds** - Better handling of timeline limits and consistency

### User Interface
- **Pass Info Cards** - Clean card-based layout for pass listings with countdown timers
- **Mobile Optimization** - Streamlined interface with timeline controls hidden on iOS
- **Debug Menu** - Advanced options (swath mode, performance stats) in dedicated menu
- **Tooltip Shortcuts** - Keyboard shortcuts displayed on all menu buttons
- **Info Box Improvements** - ESC key support, disabled spacebar scrolling for consistent shortcuts

### Orbit & Camera Features
- **Orbit Scrubbing** - Click and drag satellites along their orbit to explore passes
- **Smart Path Mode** - Color-coded orbit visualization showing ground station visibility and lighting
- **Camera Flip** - Z key to view opposite side of globe (useful when satellite is behind Earth)
- **View Toggle** - Spacebar to quickly switch between satellite tracking and ground station focus

### Technical Improvements
- **Automated Deployment** - GitHub Actions CI/CD with TLE data updates
- **Code Quality** - ESLint and Prettier integration, comprehensive E2E test suite
- **Browser Compatibility** - Replaced geo-tz with tz-lookup for better browser support
- **Error Handling** - Improved error handling for TLE data, entity tracking, and pass calculations
- **Performance** - Optimized rendering, caching strategies, and worker-based calculations

## Built With
- [CesiumJS](https://cesiumjs.org)
- [Satellite.js](https://github.com/shashwatak/satellite-js)
- [Vue.js](https://vuejs.org)
- [Workbox](https://developers.google.com/web/tools/workbox)

## Development

### Setup
Initialize submodules and install npm build dependencies:
```
git submodule update --init
npm clean-install
```

### Run
- `npm run start` for the dev server
- `npm run build` to build the application (output in `dist` folder)
- `npm run serve` to build the application and serve with static webserver
- `npm run update-tle` to retrieve the latest satellite TLEs from NORAD

## iOS App
To provide pass notifications on iOS where local browser notifications are [not
supported](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API#Browser_compatibility)
a simple app wraps the webview and handles the scheduling of
[UserNotifications](https://developer.apple.com/documentation/usernotifications).

<p align="center"><a href="https://apps.apple.com/app/satvis/id1441084766"><img src="src/assets/app-store-badge.svg" width="250" /></a></p>

## License
This project is licensed under the MIT License - see `LICENSE` file for details.

## Acknowledgements
Inspired by a visualization developed for the [MOVE-II CubeSat project](https://www.move2space.de) by Jonathan, Marco and Flo.
