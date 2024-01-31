/**
 * Converts degrees to radians
 * 
 * @param {number} deg 
 * @returns number
 */
Math.toRadians = function(deg)
{
    return deg * (Math.PI / 180);
};

/**
 * Converts radians to degrees
 * 
 * @param {number} rad 
 * @returns number
 */
Math.toDegree = function(rad)
{
    return rad * (180 / Math.PI);
}

/**
 * Rounds a number to nearest number using scale.
 * 
 * @param {number} n number
 * @param {int} s scale
 * @returns number
 */
Math.rounds = function(n, s)
{
    return Number(n.toFixed(s));
}

/**
 * Returns simple average of given arguments
 * 
 * @param {number} n number
 * @returns number
 */
Math.avg = function(n)
{
    let sum = 0;
    for (let v of arguments) {
        sum += Number(v);
    }
    return sum / arguments.length;
}

/**
 * Returns weight average of given arguments
 * 
 * @param {number} n number
 * @param {number} w weight
 * @returns number
 */
Math.avgw = function(n, w)
{
    let sum    = 0;
    let weight = 0;
    for (let i = 0; i < arguments.length; i += 2) {
        let v = Number(arguments[i]);
        let p = Number(arguments[i + 1]);
        sum += v * p;
        weight += p;
    }
    return sum / weight;
}

String.prototype.format = String.prototype.format ||
function () {
    "use strict";
    var str = this.toString();
    if (arguments.length) {
        var t = typeof arguments[0];
        var key;
        var args = ("string" === t || "number" === t) ?
            Array.prototype.slice.call(arguments)
            : arguments[0];

        for (key in args) {
            str = str.replace(new RegExp("\\{" + key + "\\}", "gi"), args[key]);
        }
    }

    return str;
};

String.prototype.hash = String.prototype.hash ||
function() {
    var hash = 0;
    if (this.length == 0) return hash;
    for (let x = 0; x < this.length; x++) {
        let ch = this.charCodeAt(x);
        hash = ((hash <<5) - hash) + ch;
        hash = hash & hash;
    }
    return hash;
}

String.prototype.entitiesEncode = String.prototype.entitiesEncode ||
function() {
    return this.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

String.prototype.entitiesDecode = String.prototype.entitiesDecode ||
function() {
    return this.replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

Array.prototype.pushUnique = function(...v) {
    var me = this;
    v.forEach((v) => {
        if (me.indexOf(v) < 0) {
            me.push(v);
        }
    });
}

Date.prototype.toISOLocalString = function() {
    return this.toLocaleString( 'sv', { timeZoneName: 'longOffset' } ).replace(/(\d) (\d)/, '$1T$2').replace(' GMT', '');
}

Object.clone = Object.prototype.clone ||
function(obj) {
    return Object.assign({}, obj);
};

Object.enumGetters = function(obj)
{
    let ref = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(obj));
    let res = {}
    for (let p in ref) {
        let d = ref[p];
        if (d.enumerable) {
            res[p] = d.value;
        }
        else if (d.get) {
            res[p] = obj[p];
        }
    }
    return res;
}
