import { loadCounter } from "../lib/dist.js";
import { MotionService as motion } from "../lib/sensor.js";
import { AppConfig as conf, restoreConfig, saveConfig } from "./config.js";

class IMUActivity
{
    constructor()
    {
        this.counter = loadCounter()
    }

    start() {
        this.result = null;
        this.counter.start(true);
    }

    stop() {
        this.counter.stop();
    }

    calibrate() {
        this.result = {
            type: 'setting',
            collected: this.counter.collectorData(),
            current: Object.clone(conf.imu.counters.current),
            suggested: this.counter.calcConf()
        };
        this.show(this.result);
    }

    accuracy() {
        this.result = {
            type: 'accuracy',
            collected: this.counter.collectorData(),
            current: conf.imu.counters.current.accuracy,
            suggested: this.counter.calcAccuracy()
        };
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
        if (this.result.type == 'setting') {
            Object.assign(conf.imu.counters[conf.imu.counter], this.result.suggested);
        }
        else {
            conf.imu.counters[conf.imu.counter].accuracy = this.result.suggested;
        }
        saveConfig();
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
        if (!confirm(`Your default counter is '${conf.imu.counter}'. Change it?`)) {
            return;
        }
        let counter = prompt('Which count do you wanna use?\n\n1-PeakY\n2-Peak3D\n3-Accel');
        switch (counter) {
            case '1':
                conf.imu.counter = 'peakY';
                break;
            case '2':
                conf.imu.counter = 'peak3d';
                break;
            case '3':
                conf.imu.counter = 'accel';
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

    compassOffset() {
        let offset = conf.imu.compass.offset;
        offset = prompt('Input compass offset, in degrees:', offset);
        if (offset !== null && !isNaN(offset)) {
            conf.imu.compass.offset = parseFloat(offset);
            saveConfig();
        }
        else {
            alert('Invalid offset...');
        }
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
        document.getElementById('btCalib').addEventListener('click', () => {
            me.calibrate();
        });
        document.getElementById('btReset').addEventListener('click', () => {
            me.reset();
        });
        document.getElementById('btShow').addEventListener('click', () => {
            me.show(conf.imu);
        });
        document.getElementById('btAccelOffset').addEventListener('click', () => {
            me.accelOffset()
        });
        document.getElementById('btCompassOffset').addEventListener('click', () => {
            me.compassOffset()
        });
        document.getElementById('btCounter').addEventListener('click', () => {
            me.setCounter()
        });
        document.getElementById('btAccur').addEventListener('click', () => {
            me.accuracy();
        });
        document.getElementById('btSave').addEventListener('click', () => {
            me.save();
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
        model.btCalib   = !collecting && !!this.counter.collectorData();
        model.btAccur   = !collecting && !!this.counter.collectorData();
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
    alert(e);
}
