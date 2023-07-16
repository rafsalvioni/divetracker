import { Peak3DistanceCounter as Peak3D, PeakYDistanceCounter as PeakY } from "../lib/dist.js";
import { MotionService as motion } from "../lib/sensor.js";
import { AppConfig as conf, restoreConfig, saveConfig } from "./config.js";

class IMUActivity
{
    constructor()
    {
        this.peakY = new PeakY();
        this.peakY.addEventListener('sample', this.__listener.bind(this));
        this.peakY.addEventListener('step', this.__listener.bind(this));

        this.peakM = new Peak3D();
        this.peakM.addEventListener('sample', this.__listener.bind(this));
        this.peakM.addEventListener('step', this.__listener.bind(this));
    }

    /**
     * 
     * @param {Event} e 
     */
    __listener(e) {
        let type = (e.target instanceof PeakY) ? 'y' : 'm';
        let data = this.collect[type];

        if (e.type == 'step') {
            data.steps++;
            return;
        }

        if (!this.collect.freq) {
            this.collect.freq = motion.freq;
        }
        else {
            this.collect.freq = parseInt(this.collect.freq + motion.freq) / 2;
        }

        data.max  = Math.max(data.max, e.detail);
        data.min  = Math.min(data.min, e.detail);
        data.avg  = (data.max + data.min) / 2;
        data.conf = (data.max + data.avg) / 2;
    }

    start() {
        this.started = Date.now();
        this.collect = {
            'y' : {
                max: 0, min: 0, steps: 0
            },
            'm' : {
                max: 0, min: 0, steps: 0
            },
        };
        this.result = null;
        this.peakY.start();
        this.peakM.start();
    }

    stop() {
        let dt = Date.now() - this.started;

        this.peakY.stop();
        this.peakM.stop();

        this.collect.y.vectorS = this.peakY.flush();
        this.collect.m.vectorS = this.peakM.flush();

        this.result = {
            collected: this.collect,
            current:   Object.clone(conf.imu),
            suggested: Object.clone(conf.imu)
        }
        let steps;
        try {
            steps = parseInt(prompt("How much steps?", Math.max(
                this.collect.y.steps, this.collect.m.steps
            )));
            let dist  = parseFloat(prompt("Whats distance, in meters?"));
            this.result.suggested.stepDist = Math.abs(dist / steps);
        } catch (e) {
            alert(e);
            return;
        }

        this.result.suggested.peakSensibility = {
            y: this.collect.y.conf,
            m: this.collect.m.conf
        };
        this.result.suggested.minInterval = dt / steps;

        this.show(this.result);
    }

    save() {
        if (!this.result) {
            alert('No data collected!');
            return;
        }
        if (!confirm("Are you sure?")) {
            return;
        }

        conf.imu = this.result.suggested;
        saveConfig();
        location.reload();
    }

    reset() {
        restoreConfig();
    }

    show(obj) {
        document.getElementById('txResult').innerHTML = JSON.stringify(obj, null, "  ")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    accelOffset()
    {
        alert('Put your device in a plan surface and don\'t touch it!. Ready?');
        
        const TIME = 5000;
        let count  = 0;
        let offset = {x: 0, y: 0, z: 0};
        let start  = Date.now();
        
        function c(e)
        {
            offset.x += e.acceleration.x;
            offset.y += e.acceleration.y;
            offset.z += e.acceleration.z;
            count++;
            let diff  = Date.now() - start;
            if (diff >= TIME) {
                window.removeEventListener('devicemotion', c, true);
                offset.x /= count;
                offset.y /= count;
                offset.z /= count;
                let str = JSON.stringify(offset);
                if (confirm(`Calibration done!\n${str}\n\nSave?`)) {
                    conf.imu.accelOffset = offset;
                    saveConfig();
                }
            }
        }
        window.addEventListener('devicemotion', c, true);
    }

    run() {
        this._updateView();
        var me = this;
        document.getElementById('btStart').addEventListener('click', () => {
            me.start();
        });
        document.getElementById('btStop').addEventListener('click', () => {
            me.stop();
        });
        document.getElementById('btSave').addEventListener('click', () => {
            me.save();
        });
        document.getElementById('btReset').addEventListener('click', () => {
            me.reset();
        });
        document.getElementById('btShow').addEventListener('click', () => {
            me.show(conf.imu);
        });
        document.getElementById('btOffset').addEventListener('click', () => {
            me.accelOffset()
        });
        this._updateId = setInterval(this._updateView.bind(this), conf.main.updateFreq);
    }

    async _updateView()
    {
        let collecting = this.peakM.active && this.peakY.active;
        let sensor = !!motion.active;
        let hasOffset = !!conf.imu.accelOffset;
        let model = {};
        if (collecting) {
            model.status = 'RECORDING';
        }
        else if (!sensor) {
            model.status = 'SENSOR ERROR';
        }
        else {
            model.status = 'IDLE';
        }
        model.btStart = sensor && !collecting && hasOffset;
        model.btStop  = collecting;
        model.btSave  = !collecting && !!this.result;
        model.btReset = !collecting;
        model.btShow  = !collecting;

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

try {
    var act = new IMUActivity();
    act.run();
}
catch (e) {
    _error(e);
}
