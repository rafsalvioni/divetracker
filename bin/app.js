import { GpsProvider as gps, FusionProvider as fus, ImuProvider } from "../lib/position.js";
import { Point, Track } from "../lib/geo.js";
import { GpxWriter } from "../lib/gpx.js";
import { MotionService as motion, OrientationService as orient } from "../lib/sensor.js";
import { DiveMap } from "../lib/map.js";
import { AppConfig as conf } from "./config.js";
import '../lib/wake.js';

const ViewHelper = {
    /**
     * 
     * @param {number} d 
     * @returns String
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
        h = (new String(h)).padStart(2, '0');
        return `${h}:${m}:${s}`;
    },
 
    /**
     * 
     * @param {Point} p 
     * @returns String
     */
    formatPosition: (p) => {
        return p.lat + ', ' + p.lon;
    },
 
    /**
     * 
     * @param {Segment} s 
     * @returns String
     */
    formatTarget: (s, r) => {
        if (s.dist <= r) {
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
     * @returns String
     */
    formatSpeed: (s) => {
        return ViewHelper.formatDistance(s) + '/s';
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
        // Starts GPX writer
        this.gpx = new GpxWriter();
        this.gpx.create();

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
        orient.addEventListener('change', (e) => {
            let bearing = orient.roundAngle(e.detail.compG);
			me.map.setBearing(bearing);
        });
        // Adds GPX POI when added POI to map
        me.map.addEventListener('poi', (e) => {
            me.gpx.addWayPoint(e.detail);
        });
    }
    
    run() {
        this._updateView();
        this._updateId = setInterval(this._updateView.bind(this), conf.main.updateFreq);
        var app = this;
        document.getElementById('btStartTrack').addEventListener('click', () => {
            app.newTrack();
        });
        document.getElementById('btStopTrack').addEventListener('click', () => {
            app.stopTrack();
        });
        document.getElementById('btGpx').addEventListener('click', () => {
            app.getGpx();
        });
        document.getElementById('btCleanGpx').addEventListener('click', () => {
            app.cleanGpx();
        });
        document.getElementById('btCalibrate').addEventListener('click', () => {
            motion.calibrate(true);
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
        let curGps = gps.last;
        let yesNo  = true;
        if (!auto && !gps.isAccurate()) {
            yesNo = window.confirm('GPS accuracy is very large. Continue?');
        }
        if (!yesNo) {
            return;
        }
        if (document.getElementById('forceImu').value == '1') {
            this.provider = new ImuProvider(curGps.pos, curGps.accur);
        }

        // New Track
        let track = new Track(curGps.pos);
        // Start components
        this.gpx.addPos(curGps.pos, track.id);
        this.map.addPoint(curGps.pos);
        // Adding track listeners to update components
        var me = this;
        track.addEventListener('change', (e) => {
            me.gpx.addPos(e.point, e.target.id);
            me.map.setPosition(e.point, me.provider.last.accur);
        });
        // Sets position provider to auto update Track
        track.updateFrom(this.provider, conf.track.calcPos);
        this.track = track;
        this.dest = 0; // Default dest
    }

    stopTrack()
    {
        if (this.track && window.confirm('Are you sure?')) {
            this.provider.destructor();
            this.provider = fus;
            this.track.updateFrom(null);
            this.track = null;
            this.map.clean();
            if (this.gpx.hasContents() && window.confirm('Save GPX now?')) {
                this.getGpx();
            }
        }
    }

    getGpx()
    {
        let name = parseInt(Date.now() / 60000);
        download(this.gpx.end(), 'application/octet-stream', 'dives-{0}.gpx'.format(name));
    }

    cleanGpx()
    {
        if (this.gpx.hasContents() && window.confirm("TRACK DATA WILL BE LOST!\n\nAre you sure?")) {
            this.gpx.create();
        }
    }
    
    async _updateView()
    {
        let last = this.provider.last;
        let model = {
            position: last ? ViewHelper.formatPosition(last.pos) : '',
            mode: this.provider.mode,
            accur: last ? ViewHelper.formatDistance(last.accur) : ''
        };
        let intrack = !!this.track;
        if (intrack) {
            model.status = 'TRACKING';
            model.speed = ViewHelper.formatSpeed(this.track.getCurrentSpeed());
            model.dist = ViewHelper.formatDistance(this.track.dist);
            model.time = ViewHelper.formatTime(this.track.getDuration());
        }
        else {
            model.status = 'IDLE';
            model.speed = '0 m/s';
            model.dist = '0 m';
            model.time = ViewHelper.formatTime(0);
        }
        model.btStartTrack = !intrack && !!gps.active;
        model.btGpx = !intrack && this.gpx.hasContents();
        model.btCleanGpx = model.btGpx;
        model.btStopTrack = !!intrack && !!gps.active;
        model.btCalibrate = !intrack;

        for (var attr in model) {
            let el = document.getElementById(attr);
            if (!el) {
                continue;
            }
            else if (typeof(model[attr]) == 'boolean') {
                el.style.display = model[attr] ? '' : 'none';
            }
            else {
                el.innerHTML = model[attr];
            }
        }
    }
}

function download(data, type, name) {
    let blob = new Blob([data], {type});
    let url  = window.URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.download = name;
    link.href = url;
    link.click();
    window.URL.revokeObjectURL(url);
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

try {
    var mainApp = new MainActivity();
    mainApp.run();
    orient.addEventListener('active', _sensorsCheck);
    motion.addEventListener('active', _sensorsCheck);
}
catch (e) {
    _error(e);
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker
        .register('./sw.js')
        .then(serviceWorker => {
            console.log('Service Worker registered: ' + serviceWorker);
        })
        .catch(error => {
            console.log('Error registering the Service Worker: ' + error);
        });
}
