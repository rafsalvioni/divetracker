import { AppConfig as conf } from '../bin/config.js';
import { Dive } from './dc.js';
import { GeoPoint, Track } from './geo.js';
import { FusionProvider as fus } from './position.js';
import './proto.js';

/**
 * Exports a GeoPoint to a simple object
 * 
 * @param {GeoPoint} point 
 * @returns object
 */
function exportPoint(point)
{
    let p = Object.assign({}, point, {
        lat: point.lat, lon: point.lon, alt: point.alt
    });
    delete p._x; delete p._y;
    return p;
}

var identLevel = 0;
/**
 * Create a XML string from a object.
 * 
 * @param {object} obj Source
 * @param {string} tagName Element's source
 * @returns string
 */
export function objToXml(obj, tagName)
{
    let ident  = '  '.repeat(identLevel);
    let xml    = `${ident}<${tagName}`;
    let text   = '';
    let childs = '';
    let node   = (typeof obj) == 'object';

    if (node) {
        for (const p in obj) {
            identLevel++;
            if (p.charAt(0) == '@') {
                if (typeof(obj[p]) == 'boolean' && !obj[p]) {
                    continue;
                }
                let v = String(obj[p]).entitiesEncode();
                xml += ` ${p.substring(1)}="${v}"`;
            }
            else if (p == '*') {
                text = String(obj[p])
            }
            else if (obj[p] instanceof Array) {
                for (const c of obj[p]) {
                    childs += objToXml(c, p);
                }
            }
            else {
                childs += objToXml(obj[p], p);
            }
            identLevel--;
        }
    }
    else {
        text = String(obj);
    }
    if (childs) {
        xml += ">\n" + text.entitiesEncode() + childs + `${ident}</${tagName}>`;
    }
    else if (text) {
        xml += ">" + text.entitiesEncode() + `</${tagName}>`;
    }
    else {
        xml += " />";
    }
    xml += "\n";
    return xml;
}

/**
 * Interval to update samples. Min 10s
 * @type number
 */
const SAMPLE_INTERVAL = Math.max(conf.track.calcPos, 10000);

/**
 * Base class for data loggers
 * 
 */
class DataLogger
{
    /**
     * Storage key
     */
    _key;

    /**
     * 
     * @param {string} key Storage key
     */
    constructor(key)
    {
        this._key = key;
        if (!localStorage[key]) {
            localStorage.setItem(key, '');
        }
    }

    /**
     * Storage iterator
     * 
     * Returns a record object and empty storage
     * 
     */
    *[Symbol.iterator]()
    {
        while (true) {
            let p = localStorage[this._key].indexOf("\x00");
            if (p < 0) {
                localStorage[this._key] = '';
                break;
            }
            let l = localStorage[this._key].substring(0, p);
            localStorage[this._key] = localStorage[this._key].substring(p + 1);
            yield JSON.parse(l);
        }
    }

    /**
     * Logger has contents?
     * 
     * @returns bool
     */
    hasContents()
    {
        return !!localStorage[this._key];
    }

    /**
     * Writes log
     * 
     * @param {object} obj 
     */
    _write(obj)
    {
        localStorage[this._key] += JSON.stringify(obj) + "\x00";
    }
}

/**
 * Logger for Track
 * 
 */
class TrackLogger extends DataLogger
{
    #curTrack;
    #track;
    
    /**
     * 
     */
    constructor()
    {
        super('*TRACK*');
    }

    /**
     * 
     * @param {Track} track
     */
    set track(track)
    {
        if (this.#track) { // Is there a current track?
            clearInterval(this._intervalId); // Stop it!
        }

        this.#track = track;
        if (!track) { // Null track? Stop
            return;
        }

        // Lets start loop!
        var me = this;
        this._intervalId = setInterval(async () => {
            if (!me.#track) {
                return;
            }
            if (me.#track.active) {
                me.logPos(me.#track);
            }
            else {
                me.track = null;
            }
        }, SAMPLE_INTERVAL);

        this.logPos(track); // Log first
    }

    /**
     * 
     * @param {Track} track 
     */
    logPos(track)
    {
        if (!track.pos) {
            return;
        }
        if (track.id != this.#curTrack) {
            this._write({
                type: 'grp', id: (new Date(track.id * 1000)).toLocaleString('sv')
            });
            this.#curTrack = track.id;
        }
        this._write({
            type: 'pos', pos: exportPoint(track.pos),
            prov: fus.mode
        });
    }

    /**
     * 
     * @param {GeoPoint} poi 
     */
    logPoi(poi)
    {
        this._write({
            type: 'poi', pos: exportPoint(poi)
        });
    }

    /**
     * Export log to a GPX xml
     * 
     * @returns String
     */
    export()
    {
        let gpx = new GpxWriter();
        let prov;
        let grp;
        for (let o of this) {
            switch (o.type) {
                case 'grp':
                    grp = o.id;
                    break;
                case 'pos':
                    if (grp) {
                        gpx.addPos(o.pos, grp, o.prov != prov);
                        prov = o.prov;
                    }
                    break;
                case 'poi':
                    gpx.addWayPoint(o.pos);
                    break;
            }
        }
        return gpx.end();
    }
}

/**
 * Utility class to generate GPX files.
 * 
 */
class GpxWriter
{
    /**
     * Current points group
     * 
     * @type string
     */
    #curGroup;
    /**
     * Last point added
     * 
     * @type Point
     */
    #lastPoint;
    /**
     * Points counter
     * 
     * @type int
     */
    #points;
    /**
     * Result XML
     * 
     * @type string
     */
    #xml;

    /**
     * 
     */
    constructor()
    {
        this.create();
    }

    /**
     * Creates a new GPX
     */
    create()
    {
        this.#curGroup  = null;
        this.#lastPoint = null;
        this.#points    = 0;
        this.#xml       = {
            '@xmlns': 'http://www.topografix.com/GPX/1/1',
            '@creator': 'DiveTracker',
            '@version': '1.1',
            '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '@xsi:schemaLocation': 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd',
            trk: [],
            wpt: []
        }
    }

    /**
     * Sets a point as way point.
     * 
     * @param {GeoPoint} point 
     */
    addWayPoint(point)
    {
        let p = exportPoint(point);
        if (!p.name) {
            p.name = "POI #{0}".format(++this.#points);
        }
        let xml = this.#makePoint(p);
        this.#xml.wpt.push(xml);
    }
    
    /**
     * Adds a position to GPX.
     * 
     * @param {GeoPoint} point 
     * @param {String} group Point's group
     */
    addPos(point, group, newseg = false)
    {
        if (group != this.#curGroup) { // When group was change (track)
            this.#startTrack(group, point);
        }
        else if (newseg) {
            this.#xml.trk.at(-1).trkseg.push({trkpt: []});
        }
        
        this.#lastPoint = point;
        this.#addTrkPoint(point);
    }
    
    /**
     * Ends current GPX e flushs their contents.
     * 
     * @returns {String}
     */
    end()
    {
        this.#endTrack();
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + objToXml(this.#xml, 'gpx');
        this.create();
        return xml;
    }

    /**
     * Adds a track point
     * 
     * @param {GeoPoint} point 
     */
    #addTrkPoint(point)
    {
        let p = this.#makePoint(point);
        this.#xml.trk.at(-1).trkseg.at(-1).trkpt.push(p);
    }

    /**
     * Creates a GPX point XML
     * 
     * @param {GeoPoint} point 
     * @returns string
     */
    #makePoint(point)
    {
        let xml  = {
            '@lat': point.lat, '@lon': point.lon, ele: point.alt,
            time: (new Date(point.timestamp)).toISOString()
        };
        if (point.name) {
            xml.name = point.name;
        }
        return xml;
    }
    
    /**
     * Starts a GPX track
     * 
     * @param {String} group 
     * @param {GeoPoint} point 
     */
    #startTrack(group, point)
    {
        this.#endTrack();
        this.#curGroup = group;
        let name   = "{0}: Start Point".format(group);
        this.addWayPoint(Object.assign(exportPoint(point), {name: name}));
        this.#xml.trk.push({
            name: group, trkseg: [ {trkpt: []} ]
        });
    }
    
    /**
     * Ends a GPX track
     * 
     */
    #endTrack()
    {
        if (this.#curGroup) {
            let name = "{0}: End Point".format(this.#curGroup);
            this.addWayPoint(Object.assign(exportPoint(this.#lastPoint), {name: name}));
            this.#curGroup = null;
        }
    }
}

/**
 * Logger for Dives
 * 
 */
class DiveLogger extends DataLogger
{
    #dive;
    #event;

    /**
     * 
     */
    constructor()
    {
        super('*DIVES*');
        this.#flushEvents();
    }

    /**
     * Returns a object sample from dive
     * 
     * @param {Dive} dive 
     * @returns object
     */
    #sample(dive)
    {
        return {
            time: dive.durSec, depth: Math.rounds(dive.curDepth, 2)
        };
    }
    
    /**
     * Flush events to append in a sample
     *
     * @returns object
     */
    #flushEvents()
    {
        let events = {};
        if (this.#event) {
            Object.assign(events, this.#event);
        }
        this.#event = {alert: []};
        return events;
    }

    /**
     * @param {Dive} dive
     */
    set dive(dive)
    {
        if (this.#dive) { // Is there a current dive?
            clearInterval(this._intervalId);
        }
        this.#dive = dive;

        if (dive) { // Is a new valid dive?
            var me = this;
            // Start sample loop
            this._intervalId = setInterval(async () => {
                if (!me.#dive) {
                    return;
                }
                if (me.#dive.active) {
                    me.logSample(me.#dive);
                }
                else if (me.#dive.ended) {
                    me.dive = null;
                }
            }, SAMPLE_INTERVAL);

            // Adds dive listeners to logger
            dive.addEventListener('start', async (e) => {
                if (fus.last && fus.last.pos) {
                    let pos   = exportPoint(fus.last.pos);
                    pos.fresh = !conf.dc.salt;
                    pos.tz    = (new Date()).getTimezoneOffset() / -60;
                    me._write({type: 'site', pos: pos});
                }
                me.#logEvent(e);
            });
            dive.addEventListener('end', async (e) => {
                me.#logEvent(e);
            });
            dive.addEventListener('event', async (e) => {
                me.#logEvent(e);
            });
            dive.addEventListener('alert', async (e) => {
                me.#logEvent(e);
            });
            dive.addEventListener('decoadd', async (e) => {
                me.#logEvent(e);
            });
        }
    }

    /**
     * 
     * @param {Dive} dive 
     */
    logSample(dive)
    {
        let s  = this.#sample(dive);
        Object.assign(s, this.#flushEvents());
        s.type = 'sample';
        this._write(s);
    }

    /**
     * 
     * @param {Event} e 
     */
    #logEvent(e)
    {
        let log, detail;
        switch (e.type) {
            case 'start':
                log = {
                    type: e.type, startDate: Date.now(),
                    decoBefore: e.target.decoBefore
                };
                break;
            case 'end':
                log = {
                    type:      e.type,
                    maxDepth:  Math.rounds(e.target.maxDepth, 2),
                    avgDepth:  Math.rounds(e.target.avgDepth, 2),
                    durSec:    e.target.durSec,
                    decoAfter: e.target.decoAfter
                };
                this.#flushEvents();
                break;
            case 'event':
                switch (e.detail) {
                    case 'gaschange':
                        detail = {mix: e.target.curMix};
                        break;
                    default:
                        return;
                }
                this.#event[e.detail] = detail;
                if (!e.target.durSec) { // Start events logged now!
                    this.logSample(e.target);
                    return;
                }
                break;
            case 'alert':
                if (!e.detail.active) return;
                switch (e.detail.type) {
                    //https://streit.cc/resources/UDDF/v3.2.3/en/alarm.html
                    case 'stop':
                        detail = 'deco';
                        break;
                    case 'ndt':
                        detail = 'rbt';
                        break;
                    default:
                        detail = e.detail.type;
                }
                this.#event['alert'].pushUnique(detail);
                break;
            case 'decoadd':
                this.#event[e.type] = e.detail;
                break;
        }
        if (log) {
            this._write(log);
        }
    }

    /**
     * Exports log to a UDDF xml
     * 
     * @returns string
     */
    export()
    {
        let uddf = new UddfWriter();
        let site = null;
        for (let o of this) {
            switch (o.type) {
                case 'site':
                    site = o.pos;
                    break;
                case 'start':
                    o.startDate = new Date(o.startDate);
                    uddf.startDive(o, site);
                    site = null;
                    break;
                case 'sample':
                    uddf.addSample(o);
                    break;
                case 'end':
                    uddf.endDive(o);
                    break;
            }
        }
        return uddf.end();
    }
}

/**
 * Utility class to generate UDDF files
 * 
 */
class UddfWriter
{
    #xml; #curDive; #endInfo; #mixes;
    #sites; #tanks;

    /**
     * 
     */
    constructor()
    {
        this.create();
    }

    /**
     * Creates a new UDDF structure
     */
    create()
    {
        this.#xml = {
            '@xmlns': 'http://www.streit.cc/uddf/3.2/', '@version': '3.2.0',
            generator: {
                name: 'DiveTracker', datetime: (new Date()).toISOLocalString(),
            },
            divesite: {site: []},
            gasdefinitions: {mix: []},
            profiledata: {repetitiongroup: []}
        };
        this.#curDive = 0;
        this.#endInfo = null;
        this.#mixes   = {};
        this.#sites   = {};
        this.#tanks   = [];
    }

    /**
     * 
     * @param {Dive} dive
     * @param {GeoPoint} pos Dive's start position
     */
    startDive(dive, pos = null)
    {
        let grp   = String(this.#xml.profiledata.repetitiongroup.length + 1);
        let desat = dive.decoBefore.desat == 0;
        if (grp == '1' || desat) {
            this.#openGroup(grp);
        }
        this.#closeDive();
        
        this.#curDive = Math.abs(this.#curDive) + 1;
        let xml = {
            '@id': `dive${this.#curDive}`,
            informationbeforedive: {
                datetime: dive.startDate.toISOLocalString(),
                surfaceintervalbeforedive: {}
            },
            samples: {waypoint: []}
        };
        if (desat) {
            xml.informationbeforedive.surfaceintervalbeforedive.infinity = null;
        }
        else {
            xml.informationbeforedive.surfaceintervalbeforedive.passedtime = dive.decoBefore.si * 60;
        }
        if (pos) {
            xml.informationbeforedive.link = {'@ref': this.#registerSite(pos)};
        }
        this.#xml.profiledata.repetitiongroup.at(-1).dive.push(xml);
    }

    /**
     * 
     * @param {Dive} dive 
     */
    endDive(dive)
    {
        this.#endInfo = dive;
        this.#closeDive();
    }

    /**
     * Adds a dive sample XML
     *
     * If there isnt a current dive, do nothing
     * 
     * @param {object} s Sample
     */
    addSample(s)
    {
        if (this.#curDive <= 0) {
            return;
        }
        let xml = {depth: s.depth, divetime: s.time};
        
        if (s.gaschange) {
            let mix = s.gaschange.mix;
            let o2  = parseInt(mix.o2 * 100);
            let id;
            switch (o2) {
                case 0  : id = 'pure_n2'; break;
                case 21 : id = 'air';     break;
                case 100: id = 'pure_o2'; break;
                default : id = `ean${o2}`;
            }
            if (!this.#mixes[id]) {
                this.#mixes[id] = mix;
            }
            this.#tanks.push(id);
            xml.switchmix = {'@ref': id};
        }
        if (s.decoadd) {
            let stop = s.decoadd;
            xml.decostop = {
                '@kind': (stop.required ? 'mandatory' : 'safety'),
                '@decodepth': stop.depth, '@duration': stop.sec
            };
        }
        if (s.alert && s.alert[0]) {
            xml.alarm = Array.from(s.alert.values());
        }
        this.#xml.profiledata.repetitiongroup.at(-1).dive.at(-1).samples.waypoint.push(xml);
    }
    
    /**
     * Ends UDDF and returns its contents
     * 
     * @returns string
     */
    end()
    {
        this.#closeDive();

        for (let siteId in this.#sites) {
            let site = this.#sites[siteId];
            this.#xml.divesite.site.push({
                '@id': siteId, name: siteId,
                geography: {
                    latitude: site.lat, longitude: site.lon, altitude: site.alt, timezone: site.tz
                },
                sitedata: {density: site.fresh ? '1000' : '1030'}
            });
        }

        for (let mix in this.#mixes) {
            this.#xml.gasdefinitions.mix.push({
                '@id': mix, name: mix, o2: this.#mixes[mix].o2, he: 0
            });
        }

        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + objToXml(this.#xml, 'uddf');
        this.create();
        return xml;
    }

    /**
     * Appends a end dive XML, if there is one
     */
    #closeDive()
    {
        if (this.#curDive > 0) {
            let dive = this.#xml.profiledata.repetitiongroup.at(-1).dive.at(-1);
            if (this.#endInfo) {
                dive.informationafterdive = {
                    greatestdepth:    this.#endInfo.maxDepth,
                    averagedepth:     this.#endInfo.avgDepth,
                    diveduration:     this.#endInfo.durSec,
                    desaturationtime: this.#endInfo.decoAfter.desat * 60,
                    noflighttime:     this.#endInfo.decoAfter.noFly * 60 
                };
                this.#endInfo = null;
            }
            dive.tankdata = [];
            for (let mix of this.#tanks) {
                dive.tankdata.push({link: {'@ref': mix}});
            }
            this.#tanks    = [];
            this.#curDive *= -1;
        }
    }

    /**
     * Appends a new repetition group
     */
    #openGroup(grp)
    {
        this.#xml.profiledata.repetitiongroup.push({
            '@id': `rg${grp}`, dive: []
        });
    }

    /**
     * Register a dive site and returns its ID
     * 
     * @param {GeoPoint} pos 
     * @returns string
     */
    #registerSite(pos)
    {
        let id = 'site' + (String(Math.rounds(pos.lat, 4)) + String(Math.rounds(pos.lon, 4))).hash();
        this.#sites[id] = pos;
        return id;
    }
}

/**
 * 
 * @param {string} data Contents
 * @param {string} type mime type
 * @param {string} name Filename
 */
function download(data, type, name) {
    let blob = new Blob([data], {type});
    let url  = window.URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.download = name;
    link.href = url;
    link.click();
    window.URL.revokeObjectURL(url);
}

export const trackLogger = new TrackLogger();
export const diveLogger  = new DiveLogger();

/**
 * Is there logs?
 * 
 * @returns boolean
 */
export function hasLogs() {
    return diveLogger.hasContents() || trackLogger.hasContents();
}

/**
 * Clean all logs
 * 
 */
export function cleanLogs() {
    if (!window.confirm("LOGGED DATA WILL BE LOST!\n\nAre you sure?")) {
        return;
    }
    for (let k in localStorage) {
        if (k[0] == '*') {
            localStorage.setItem(k, '');
        }
    }
}

/**
 * Download all logs that have contents
 * 
 */
export function downloadLogs() {
    let name = 'dives-{0}'.format(parseInt(Date.now() / 60000));
    if (trackLogger.hasContents()) {
        download(trackLogger.export(), 'application/octet-stream', name + '.gpx');
    }
    if (diveLogger.hasContents()) {
        download(diveLogger.export(), 'application/octet-stream', name + '.uddf');
    }
}
