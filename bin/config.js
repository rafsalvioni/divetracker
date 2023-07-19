/**
 * Default config
 * 
 */
const defaultConf = {
    gps: {
        minAccur: 10, // Minimal accuracy to trust in GPS
        activeFreq: 10000, // Time, in millis, to consider GPS signal lost
    },
    imu: {
        accelOffset: false, // Accelerator bias
        compassScale: 10, // Scale to use in compass readings
        counter: 'peak3d',
        counters: { // Distance counters settings
            peakY: {
                accuracy: .94, // Counter's accuracy
                stepDist: 0.7, // Average distance by step, in meters
                threshold: 3 // Minimum peak in Y
            },
            peak3d: {
                accuracy: .94, // Counter's accuracy
                stepDist: 0.7, // Average distance by step, in meters
                threshold: 2, // Minimum total
                minInterval: 750 // Minimum interval between peaks
            },
            accel: {
                accuracy: .94, // Counter's accuracy
                threshold: 1 // Threshold to consider a valid movement
            }
        },
    },
    track: {
        calcPos: 5000, // Time, in millis, to update track position
        autoStartOnLostGps: true, // Auto start a track when GPS signal is lost
        forceImu: false, // Forces use of IMU instead GPS (for land tests...),
        minDist: 5, // Minimum distance to consider stay in a location
    },
    main: {
        updateFreq: 1000 // Time, in millis, to update view
    }
};

const configKey = '_config_';

/**
 * Loads a config from localStorage, if there is one.
 * 
 * Else, return default config
 * 
 * @returns object
 */
function loadConfig()
{
    let ret = Object.assign({}, defaultConf);
    if (!window.localStorage) {
        return ret;
    }
    try {
        let saved = localStorage.getItem(configKey);
        if (saved) {
            ret = Object.assign(ret, JSON.parse(saved));
        }
    } catch (e) {
        alert('Error reading config... Using the default one');
        localStorage.removeItem(configKey);
    }
    // Link to selected counter's settings
    ret.imu.counters.current = ret.imu.counters[ret.imu.counter];
    return ret;
}

/**
 * Saves current config on localStorage
 * 
 * @param {object} append 
 */
export function saveConfig(append = {})
{
    if (!window.localStorage) {
        alert('Unable to save config. Your browser doesn\'t support localStorage');
        return;
    }

    let conf = Object.assign({}, defaultConf, AppConfig, append);
    localStorage.setItem(configKey, JSON.stringify(conf));
    if (localStorage[configKey]) {
        alert('Config saved! Page will be reloaded');
        location.reload();
    }
}

/**
 * Restores default config
 * 
 */
export function restoreConfig()
{
    if (confirm("Do you really restore configuration to default?")) {
        localStorage.removeItem(configKey);
        location.reload();
    }
}

/**
 * Returns default config
 * 
 * @returns object
 */
export function defaultConfig()
{
    return defaultConf;
}

export const AppConfig = loadConfig();