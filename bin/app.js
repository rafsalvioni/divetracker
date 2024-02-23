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
    formatSpeed: (s, t = 's') => {
        return ViewHelper.formatDistance(s) + `/${t}`;
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
            return `DS ${stop.depth}m`;
        }
        else {
            return `No${stop.optional ? '*' : ''}`;
        }
    }
}
 
class MainActivity
{
    constructor() {

        var me = this;

        // Default position provider;
        this.provider = fus;

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

        // Listener when a dive is created
        dc.addEventListener('dive', (d) => {
            let dive = d.target.dive;
            // Add dive to logger
            diveLogger.dive = dive;
            // Adds dive listeners to show alerts
            dive.addEventListener('sample', async (e) => {
                let alerts = dive.alerts;
                let trans  = {'mod': 'depth', 'time': 'timeLeft', 'stop': 'deco', 'ascent': 'speed'};
                for (const alert in trans) {
                    const active = alerts.indexOf(alert) >= 0;
                    const id = trans[alert] ?? null;
                    if (id) {
                        document.getElementById(id).style = 'color: {0}'.format(active ? '#ff0000' : 'inherit');
                    }
                    if (active) {
                        navigator.vibrate(500);
                    }
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
        var me = this;
        
        // New Track
        let track = new Track();
        // Updates DC and map from track
        track.addEventListener('change', async (e) => {
            dc.update(e.target);
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
                bearing: orient.active ? `${orient.roundAngle(orient.last.compG)}º` : 'N/D',
                lat: last ? last.pos.lat : 'N/D',
                lon: last ? last.pos.lon : 'N/D',
                posprov: me.provider.mode,
                accur: last ? ViewHelper.formatDistance(last.accur) : 'N/D',
                imu: (orient.active && motion.active ? 'OK' : 'ERROR')
            };

            let intrack = !!me.track;
            model.tbTrack = intrack;
            if (intrack) {
                model.duration = ViewHelper.formatTime(me.track.duration);
            }

            model.tbDive = dc.inDive;
            model.btTank = false;
            model.tbAfter = false;
            if (dc.inDive) {
                model.deco = ViewHelper.decoInfo(dc.dive);
                model.gas = dc.dive.tankId;
                let tank = dc.dive.nextTank();
                if (tank) {
                    model.btTank = `NT: ${tank.mix.name}`;
                    document.getElementById('btTank').disabled = !dc.dive.isMixUsable(tank.mix);
                }
                const tl = dc.dive.timeLeft;
                model.timeLeft = `(${tl.source}) ${tl.time}'`;
            }
            else if (dc.isDesat) {
                model.tbAfter = true;
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
            if (dc.isDesat) {
                let state = dc.desatState;
                model.si = ViewHelper.formatTime(state.si);
                model.nofly = ViewHelper.formatTime(state.noFly);
                model.nodive = ViewHelper.formatTime(state.noDive);
                model.desat = ViewHelper.formatTime(state.desat);
            }
        }, 60000); // By minute

        setInterval(async () => {
            let model = {};
            let intrack = !!me.track;
            if (intrack) {
                model.trackSpeed = ViewHelper.formatSpeed(this.track.curSpeed);
                model.dist = ViewHelper.formatDistance(this.track.dist);
                model.gohome = ViewHelper.formatTarget(this.track.toStart());
            }
            if (dc.inDive) {
                model.depth = ViewHelper.formatDistance(dc.depth);
                const TL = dc.dive.timeLeft;
                model.timeLeft = `(${TL.source}) ${TL.time}`;
                model.diveSpeed = ViewHelper.formatSpeed(dc.dive.speed, 'min');
                model.bar = dc.curTank.end.round();
            }

            _update(model);    
        }, conf.track.calcPos * 1.05); // By track time

        let model = {};
        model.tbDive  = false;
        model.tbTrack = false;
        model.tbAfter = dc.isDesat;
        model.btStartTrack = !!gps.active;
        model.btLogs = hasLogs();
        model.btCleanLogs = model.btLogs;
        model.btStopTrack = false;
        model.btCalibrate = true;
        model.btDive      = true;
        model.btDistCounter = true;
        model.btPlan = true;
        model.btTank = false;
        _update(model); // Initial state
    }
}

try {
    var mainApp = new MainActivity();
    mainApp.run();
}
catch (e) {
    console.log(e);
}

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
