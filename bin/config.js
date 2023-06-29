const defaultConf = {
    gps: {
        minAccur: 10, // Minimal accuracy to consider GPS
        activeFreq: 10000, // Time, in millis, to consider GPS signal lost
    },
    imu: {
        compassScale: 10, // Scale to use in compass readings
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

const configKey = '_config';

function loadConfig()
{
    let ret = defaultConf;
    if (!window.localStorage) {
        return ret;
    }
    try {
        let saved = localStorage.getItem(configKey);
        if (saved) {
            ret = Object.assign(ret, JSON.parse(saved));
        }
        else {
            //saveConfig(ret);
        }
    } catch (e) {
        alert('Error reading config... Using the default one');
        //saveConfig(defaultConf);
    }
    return ret;
}

export function saveConfig(conf)
{
    if (!window.localStorage) {
        alert('Unable to save config. Your browser doesn\'t support localStorage');
        return;
    }
    conf = Object.assign(defaultConf, conf);
    let exists = !!localStorage.getItem(configKey);
    localStorage.setItem(configKey, JSON.stringify(conf));
    if (exists) {
        alert('Config saved! Please restart app to apply it!');
    }
}

export const AppConfig = loadConfig();