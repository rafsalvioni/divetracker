/**
 * Default config
 * 
 */
const DEFAULT_CONF = {
    gps: {
        minAccur: 10, // Minimal accuracy to trust in GPS
    },
    imu: {
        accelOffset: false, // Accelerator bias
        compass: {
            scale: 10, // Scale to use in compass readings
            offset: 0 // Offset to use on interference places (like a metal box)
        },
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
        calcPos: 2000, // Time, in millis, to update track position
        autoStartOnLostGps: true, // Auto start a track when GPS signal is lost
        forceImu: false, // Forces use of IMU instead GPS (for land tests...),
        minDist: 5, // Minimum distance to consider stay in a location
    },
    dc: {
        tanks: [], // No tank? Defaults with AIR
        maxPpo2: 1.4,
        salt: true,
        o2narco: true,
        rmv: 15,
        gfLow: .8
    },
    main: {}
};

const CONFIG_STORAGE = '__config__';

/**
 * Loads a config from localStorage, if there is one.
 * 
 * Else, return default config
 * 
 * @returns object
 */
function loadConfig()
{
    let ret = Object.assign({}, DEFAULT_CONF);
    if (!window.localStorage) {
        return ret;
    }
    try {
        let saved = localStorage.getItem(CONFIG_STORAGE);
        if (saved) {
            ret = Object.assign(ret, JSON.parse(saved));
        }
    } catch (e) {
        alert('Error reading config... Using the default one');
        localStorage.removeItem(CONFIG_STORAGE);
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

    let conf = Object.assign({}, DEFAULT_CONF, AppConfig, append);
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(conf));
    if (localStorage[CONFIG_STORAGE]) {
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
        localStorage.removeItem(CONFIG_STORAGE);
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
    return DEFAULT_CONF;
}

export const AppConfig = loadConfig();