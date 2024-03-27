import { GpsProvider as gps, FusionProvider as fus, ImuProvider } from "../lib/position.js";
import { GeoPoint, Track } from "../lib/geo.js";
import { MotionService as motion, OrientationService as orient } from "../lib/sensor.js";
import { DiveMap } from "../lib/map.js";
import { AppConfig as conf } from "./config.js";
import '../lib/wake.js';
import { dc, configDive } from "../lib/dc.js";
import { cleanLogs, downloadLogs, hasLogs, trackLogger, diveLogger } from "../lib/logger.js";

const ViewHelper = {
    /**
     * 
     * @param {number} d 
     * @returns string
     */
    formatDistance: (d) =>{
        if (d == null) {
            return '??';
        }
        else if (Math.abs(d) > 1000) {
            return Math.rounds(d / 1000, 2) + ' km';
        }
        else {
            return Math.rounds(d, 2) + ' m';
        }
    },

    /**
     * 
     * @param {number} t Time in seconds
     * @returns 
     */
    formatTime: (t) => {
        let s = Math.floor(t);
        let m = Math.floor(s / 60);
        let h = Math.floor(m / 60);
        s = (new String(s % 60)).padStart(2, '0');
        m = (new String(m % 60)).padStart(2, '0');
        if (h > 0) {
            h = (new String(h)).padStart(2, '0');
            return `${h}:${m}:${s}`;
        }
        return `${m}:${s}`;
    },
 
    /**
     * 
     * @param {GeoPoint} p 
     * @returns string
     */
    formatPosition: (p) => {
        return p.lat + ', ' + p.lon;
    },
 
    /**
     * 
     * @param {Segment} s 
     * @returns string
     */
    formatTarget: (s) => {
        if (s.dist <= conf.track.minDist) {
            return 'You are here!';
        }
        return "{0}º GN / {1}".format(
            Math.round(s.dir),
            ViewHelper.formatDistance(s.dist)
        ); 
    },
 
    /**
     * 
     * @param {number} s 
     * @returns string
     */
    formatSpeed: (s) => {
        return ViewHelper.formatDistance(s) + '/s';
    },

    /**
     * 
     * @param {Dive} d 
     * @returns string
     */
    decoInfo: (d) => {
        if (!d || !d.active) {
            let si = +dc.si;
            return isFinite(si) ? `SI ${ViewHelper.formatTime(si)}` : 'N/A';
        }
        const stop = d.decoStops.current;
        if (stop.active) {
            return ViewHelper.formatTime(stop.sec);
        }
        else if (stop.depth && !stop.optional) {
            return `DS@${stop.depth}m`;
        }
        else {
            let time = d.timeLeft;
            return `(${time.source}) ${time.time}${stop.optional ? '*' : ''}`;
        }
    }
}
 
class MainActivity
{
    constructor() {

        var me = this;

        if (!('geolocation' in navigator)) {
            throw 'GPS not supported!'; 
        }
        if (!('ondeviceorientationabsolute' in window)) {
            throw 'Absolute orientation not supported!'; 
        }
        if (!('ondevicemotion' in window)) {
            throw 'Device motion not supported!'; 
        }

        // Default position provider;
        this.provider = fus;

        // Loads the map
        this.map = new DiveMap(document.getElementById('nav'));

        // Add listener for auto start
        gps.addEventListener('active', async (e) => {
            if (!conf.track.autoStartOnLostGps) {
                return;
            }
            if (!this.track && gps.last && !gps.active) {
                me.newTrack(true);
                try {
                    navigator.vibrate(1000);
                } catch(e) {
                    console.log(e);
                }
            }
        });

        // Update Map bearing when orientation changes
        orient.addEventListener('change', async (e) => {
            let bearing = orient.roundAngle(e.detail.compG);
            me.map.bearing = bearing;
        });
        // Logs POI in TrackLogger when added POI to map
        me.map.addEventListener('poi', async (e) => {
            trackLogger.logPoi(e.detail);
        });
        // Listener when a dive is created
        dc.addEventListener('dive', (d) => {
            let dive = d.target.dive;
            // Add dive to logger
            diveLogger.dive = dive;
            // Adds dive listeners to show alerts
            dive.addEventListener('alert', async (e) => {
                let alerts = {'mod': 'depth', 'time': 'deco', 'stop': 'deco', 'ascent': 'speed'};
                if (alerts[e.detail.type]) {
                    document.getElementById(alerts[e.detail.type]).style = 'color: {0}'.format(e.detail.active ? '#ff0000' : 'inherit');
                }
                if (e.detail.active) {
                    navigator.vibrate(500);
                }
            });
        });
    }
    
    run() {
        this._updateView();
        var app = this;
        document.getElementById('btStartTrack').addEventListener('click', () => {
            app.newTrack();
        });
        document.getElementById('btStopTrack').addEventListener('click', () => {
            app.stopTrack();
        });
        document.getElementById('btLogs').addEventListener('click', () => {
            downloadLogs();
        });
        document.getElementById('btCleanLogs').addEventListener('click', () => {
            cleanLogs();
        });
        document.getElementById('btCalibrate').addEventListener('click', () => {
            location.href = 'imu.html';
        });
        document.getElementById('btDive').addEventListener('click', () => {
            configDive();
        });
        document.getElementById('btPlan').addEventListener('click', () => {
            app.planDive();
        });
        document.getElementById('btTank').addEventListener('click', (e) => {
            if (dc.inDive) {
                let tank;
                if ((tank = dc.dive.nextTank()) && dc.dive.isMixUsable(tank.mix)) {
                    dc.dive.changeTank(tank);
                    e.target.style.display = 'none';
                }
            }
        });
        document.getElementById('forceImu').value = !!conf.track.forceImu ? '1' : '0';
    }

    newTrack(auto=false)
    {
        if (!gps.last) {
            alert('No GPS position found!');
            return;
        }
        if (!orient.active) {
            alert('Compass is inactive!');
            return;
        }
        if (!motion.active) {
            alert('Motion sensor is inactive!');
            return;
        }
        let yesNo  = true;
        if (!auto && !gps.isAccurate()) {
            yesNo = window.confirm('GPS accuracy is very large. Continue?');
        }
        if (!yesNo) {
            return;
        }
        if (document.getElementById('forceImu').value == '1') {
            this.provider = new ImuProvider(gps.last);
        }
        var me = this;
        
        // New Track
        let track = new Track();
        // Updates DC and map from track
        track.addEventListener('change', async (e) => {
            dc.update(e.target);
            me.map.fromProvider(me.provider.last);
        });
        // Sets position provider to auto update Track
        track.updateFrom(this.provider, conf.track.calcPos);
        // When there is a provider, add to logger
        trackLogger.track = track;
        this.track = track;
    }

    stopTrack()
    {
        if (this.track && window.confirm('Are you sure?')) {
            this.provider.destructor();
            this.provider = fus;
            this.track.updateFrom(null);
            dc.update(this.track);
            this.track = null;
            trackLogger.track = null;
            if (dc.inDive) {
                dc.dive.end();
                diveLogger.dive = null;
            }
            this.map.clean();
        }
    }

    planDive()
    {
        let plan = dc.plan();
        let str = `Water: ${plan.water}, SP: ${plan.sp.round(2)} bar, RMV: ${plan.rmv} l/min\n`; // Env
        str += `Gas: ${plan.mix}(+${plan.tanks-1}), MOD: ${plan.mod}, MND: ${plan.mnd}, pO2: ${plan.pO2}\n`; // GAS
        str += `GF: ${plan.gf}, Satur: ${plan.satur}%, CNS: ${plan.cns}%, OTU: ${plan.otu}\n\n` // Body
        let i   = 0;
        if (!plan.dives.length) {
            str += `**** No dives allowed at this time ****\n\n`;
        }
        str += `${i++}- (${plan.break})\n`;
        for (let p of plan.dives) {
            str += `${i++}- ${p.depth}m@${p.time}'(${p.limiter}), ASC: ${p.asc}', BM: ${p.bestmix}`;
            str += "\n";
        }
        alert(str);
    }

    _updateView()
    {
        if (this._updateId) {
            return;
        }
        this._updateId = true;

        function _update(model)
        {
            for (var attr in model) {
                let el = document.getElementById(attr);
                if (!el) {
                    continue;
                }
                else if (!model[attr]) {
                    el.style.display = 'none';
                }
                else {
                    el.style.display = '';
                    if (typeof(model[attr]) != 'boolean') {
                        el.innerHTML = model[attr];
                    }
                }
            }
        }

        var me = this;

        setInterval(async () => {
            let last = me.provider.last;
            let model = {
                position: last ? ViewHelper.formatPosition(last.pos) : '',
                mode: me.provider.mode,
                accur: last ? ViewHelper.formatDistance(last.accur) : ''
            };
            let intrack = !!me.track;
            if (intrack) {
                model.status = 'TRACKING';
                model.time   = ViewHelper.formatTime(me.track.duration);
            }
            else {
                model.status = 'IDLE';
                model.speed  = '0 m/s';
                model.dist   = '0 m';
                model.time   = '00:00:00';
                model.depth  = 'N/D';
            }

            model.btTank = false;
            if (dc.inDive) {
                model.deco = ViewHelper.decoInfo(dc.dive);
                let tank = dc.dive.nextTank();
                if (tank) {
                    model.btTank = `NT: ${tank.mix.id}`;
                    document.getElementById('btTank').disabled = !dc.dive.isMixUsable(tank.mix);
                }
            }
            
            model.btStartTrack = !intrack && !!gps.active;
            model.btLogs = !intrack && hasLogs();
            model.btCleanLogs = model.btLogs;
            model.btStopTrack = !!intrack && !!gps.active;
            model.btCalibrate = !intrack;
            model.btDive      = !intrack;
            model.btDistCounter = !intrack;
            model.btPlan = model.btStartTrack;

            _update(model);
        }, 1000); // By second

        setInterval(async () => {
            let model = {};
            if (!dc.inDive) {
                model.deco = ViewHelper.decoInfo(dc.dive);
                _update(model);
            }
        }, 60000); // By minute

        setInterval(async () => {
            let model = {};
            let intrack = !!me.track;
            if (intrack) {
                model.speed = ViewHelper.formatSpeed(this.track.curSpeed);
                model.dist = ViewHelper.formatDistance(this.track.dist);
                model.depth = ViewHelper.formatDistance(dc.depth);
            }

            _update(model);    
        }, conf.track.calcPos * 1.05); // By track time

        let model = {};
        model.btStartTrack = !!gps.active;
        model.btLogs = hasLogs();
        model.btCleanLogs = model.btLogs;
        model.btStopTrack = false;
        model.btCalibrate = true;
        model.btDive      = true;
        model.btDistCounter = true;
        model.btPlan = true;
        model.btTank = false;
        model.deco = ViewHelper.decoInfo(dc.dive);
        _update(model); // Initial state
    }
}

function toogleDisplay(el, show=true) {
    let _show = typeof(show) == 'boolean' ? show : !(el.style.display == 'none');
    el.style.display = _show ? '' : 'none';
}

var main    = document.getElementById('main');
var check   = document.getElementById('check');

function _sensorsCheck(e)
{
    if (orient.active && motion.active) {
        _error(null);
    }
    else {
        _error('Sensor(s) failed!');
    }
}

function _error(e) {
    if (e) {
        check.childNodes[0].innerHTML = e;
        toogleDisplay(main, false);
        toogleDisplay(check, true);
    }
    else {
        toogleDisplay(main, true);
        toogleDisplay(check, false);
    }
}

//try {
    var mainApp = new MainActivity();
    mainApp.run();
    orient.addEventListener('active', _sensorsCheck);
    motion.addEventListener('active', _sensorsCheck);
/*}
catch (e) {
    _error(e);
}*/

if ('serviceWorker' in navigator && location.hostname != 'localhost') {
    navigator.serviceWorker
        .register('./sw.js')
        .then(serviceWorker => {
            console.log('Service Worker registered: ' + serviceWorker);
        })
        .catch(error => {
            console.log('Error registering the Service Worker: ' + error);
        });
}
