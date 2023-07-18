import { loadCounter } from "../lib/dist.js";
import { MotionService as motion } from "../lib/sensor.js";
import { Vector } from "../lib/trigo.js";
import { AppConfig as conf, restoreConfig, saveConfig } from "./config.js";

class IMUActivity
{
    constructor()
    {
        this.counter = loadCounter()
        this.counter.addEventListener('sample', this.__listener.bind(this));
        this.counter.addEventListener('step', this.__listener.bind(this));
    }

    /**
     * 
     * @param {Event} e 
     */
    __listener(e) {
        let data = this.collect;

        if (e.type == 'step') {
            data.steps++;
            data.dist += Vector.create(e.detail).size;
            return;
        }

        if (!data.freq) {
            data.freq = motion.freq;
        }
        else {
            data.freq = parseInt(data.freq + motion.freq) / 2;
        }

        data.max = Math.max(data.max, e.detail);
        data.min = Math.min(data.min, e.detail);
        data.avg = (data.max + data.min) / 2;
    }

    start() {
        this.collect = {
            max: 0, min: 0, steps: 0, dist: 0
        };
        this.result = null;
        this.counter.start();
        this.started = Date.now();
    }

    stop() {
        let dt = Date.now() - this.started;

        this.counter.stop();

        this.collect.vectorS = this.counter.flush();

        this.result = {
            collected: this.collect,
            current:   Object.clone(conf.imu),
            suggested: Object.clone(conf.imu)
        }
        let steps;
        try {
            steps = parseInt(prompt("How much steps?", Math.max(
                this.collect.steps
            )));
            let dist  = parseFloat(prompt("Whats distance, in meters?"));
            this.result.suggested.stepDist = Math.abs(dist / steps);
        } catch (e) {
            alert(e);
            return;
        }

        this.result.suggested.threshold = this.collect.max * .6;
        this.result.suggested.minInterval = (dt / steps) * .75;

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

    setCounter()
    {
        if (!confirm(`Your default counter is '${conf.imu.counters.default}'. Change it?`)) {
            return;
        }
        let counter = prompt('Which count do you wanna use?\n\n1-PeakY\n2-Peak3D\n3-Accel');
        switch (counter) {
            case '1':
                conf.imu.counters.default = 'peakY';
                break;
            case '2':
                conf.imu.counters.default = 'peak3d';
                break;
            case '3':
                conf.imu.counters.default = 'accel';
                break;
            default:
                alert('Invalid choice...');
                return;
        }
        saveConfig();
    }

    accelOffset()
    {
        const TIME = 10000;
        alert(`Put your device in a plan surface and don\'t touch it by ${TIME / 1000}s!\n\nReady?`);
        
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
        document.getElementById('btCounter').addEventListener('click', () => {
            me.setCounter()
        });
        this._updateId = setInterval(this._updateView.bind(this), conf.main.updateFreq);
    }

    async _updateView()
    {
        let collecting = this.counter.active;
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
        model.btStart   = sensor && !collecting && hasOffset;
        model.btStop    = collecting;
        model.btSave    = !collecting && !!this.result;
        model.btReset   = !collecting;
        model.btShow    = !collecting;
        model.btCounter = !collecting;

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
