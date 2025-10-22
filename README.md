# SatVis - Enhanced Fork ![Node CI](https://github.com/anttikuosmanen-rgb/satvis/workflows/Node%20CI/badge.svg) ![Deploy](https://github.com/anttikuosmanen-rgb/satvis/workflows/Deploy%20to%20GitHub%20Pages/badge.svg)

Satellite orbit visualization and pass prediction with enhanced features.

> [!NOTE]
> This is an enhanced fork of [Flowm/satvis](https://github.com/Flowm/satvis) with significant improvements to pass prediction, timeline visualization, and ground station features.
>
> **Live Demo:** [https://anttikuosmanen-rgb.github.io/satvis/](https://anttikuosmanen-rgb.github.io/satvis/)
>
> **Active Branch:** `merge-upstream-2-ursa-features` contains the latest improvements and is automatically deployed to GitHub Pages.

![Screenshot](https://anttikuosmanen-rgb.github.io/satvis/data/images/screenshot.png)

## Features
- Calculate position and orbit of satellites from TLE
- Set groundstation through geolocation or pick on map
- Calculate passes for a set groundstation
- Local browser notifications for passes
- Serverless architecture
- Works offline as Progressive Web App (PWA)

## Enhanced Features in This Fork

### Zenith View - Ground-Level Sky Viewing
View satellite passes from a ground-level perspective, looking up at the sky from your ground station location.

- **Sky-Up Camera** - Top-down view with camera fixed at ground station, simulating observer's perspective of satellites passing overhead
- **Pass Tracking** - Watch satellites move across the sky as they would appear from your location during passes
- **Toggle Mode** - Switch between normal 3D globe view and zenith view with ground station menu button

### Timeline & Pass Visualization
- **Timeline Zoom Controls** - Plus/minus buttons for smooth timeline zoom in (0.75x) and zoom out (1.33x)
- **Ground Station Daytime Highlights** - Visual indicators showing daylight periods at ground station location
- **Improved Pass Highlights** - Visual timeline markers showing satellite passes with better visibility
- **Pass Time Navigation** - Click pass entries in info panel to jump timeline to pass start time while maintaining zoom level
- **Polar Coordinate Support** - Proper daytime calculation and caching for polar regions

### Ground Station Features
- **Zenith View Mode** - Top-down view from ground station perspective for better pass visualization
- **Local Time Display** - Show ground station local timezone alongside UTC
- **Pass Filtering Options** - Filter passes by sunlight conditions (hide sunlit passes, show only lit satellite passes)
- **GEO Satellite Handling** - Proper display of continuous visibility for geostationary satellites

### Pass Prediction Improvements
- **Optimized Pass Calculations** - Caching and chunked processing for better performance
- **Epoch-Based Filtering** - Accurate pass predictions for pre-launch satellites with future epochs
- **Eclipse Transition Times** - Display when satellites enter/exit Earth's shadow during passes
- **Pass Cache Invalidation** - Automatic cache updates when filters or settings change
- **Enhanced Pass Details** - Improved formatting and information display in pass listings

### Pre-launch Satellite Support
- **Pre-launch Group** - Dedicated satellite group for upcoming launches (marked with *)
- **Automated Data Updates** - GitHub Actions workflow updates TLE and pre-launch data on deployment
- **Epoch Clamping** - Proper handling of satellites with future launch dates

### User Interface Enhancements
- **Improved Timeline Bounds** - Better handling of timeline limits and zoom consistency
- **Timeline Zoom Preservation** - Zoom level maintained when navigating to passes or using time controls
- **Mobile UI Optimization** - Cleaner interface with timeline controls hidden on iOS devices
- **Debug Menu** - Moved advanced options (swath mode, etc.) to dedicated debug section
- **Performance Stats** - Optional performance monitoring display

### Technical Improvements
- **Automated Deployment** - GitHub Actions workflow for continuous deployment
- **Code Quality** - ESLint and Prettier integration for consistent code formatting
- **Browser Compatibility** - Replaced geo-tz with tz-lookup for better browser support
- **Runtime Error Handling** - Improved error handling for TLE data updates and entity tracking

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
