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
    return Object.assign({}, point, {
        lat: point.lat, lon: point.lon, alt: point.alt
    });
}

/**
 * Interval to update samples. Min 10s
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
                me.#logPos(me.#track);
            }
            else {
                me.track = null;
            }
        }, SAMPLE_INTERVAL);

        this.#logPos(track); // Log first
    }

    /**
     * 
     * @param {Track} track 
     */
    #logPos(track)
    {
        if (!track.pos) {
            return;
        }
        if (track.id != this.#curTrack) {
            this._write({
                type: 'grp', trackid: track.id
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
            if (o.type == 'grp') {
                grp = o.trackid;
            }
            if (o.type == 'pos' && grp) {
                gpx.addPos(o.pos, grp, o.prov != prov);
                prov = o.prov;
            }
            else if (o.type == 'poi') {
                gpx.addWayPoint(o.pos)
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
     * @var string
     */
    #curGroup;
    /**
     * Last point added
     * 
     * @var Point
     */
    #lastPoint;
    /**
     * Points counter
     * 
     * @var int
     */
    #points;
    /**
     * Result XML
     * 
     * @var string
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
        this.#xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n\
<gpx\
 xmlns=\"http://www.topografix.com/GPX/1/1\"\
 creator=\"Salvioni\'s GPX Creator\" \
 version=\"1.1\"\
 xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \
 xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\">\n";
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
        let poi   = "\t" + this.#makePoint(p, true);
        this.#xml = this.#xml.replace(/(<gpx [^>]+>\n)/i, `$1${poi}`);
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
            this.#xml += "\t\t</trkseg>\n\t\t<trkseg>\n";    
        }
        
        this.#lastPoint = point;
        this.#addTrkPoint(point);
    }
    
    /**
     * Ends current GPX e flushs their contents.
     * 
     * @return {String}
     */
    end()
    {
        this.#endTrack();
        let xml = this.#xml + '</gpx>';
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
        this.#xml += "\t\t\t" + this.#makePoint(point);
    }

    /**
     * Creates a GPX point XML
     * 
     * @param {GeoPoint} point 
     * @param {boolean} wpt Is way point?
     * @returns string
     */
    #makePoint(point, wpt = false)
    {
        let name = '';
        let tag  = '';
        if (!wpt) { // Track point
            tag = 'trk';
        }
        else if (point.name) { // Way point if has a name
            tag  = 'w';
            name = `<name>${point.name.entitiesEncode()}</name>`;
        }
        else { // None.. Return empty
            return '';
        }
        let dt  = new Date(point.timestamp);
        let xml = `<${tag}pt lat="${point.lat}" lon="${point.lon}">\
<ele>${point.alt ?? 0}</ele>\
<time>${dt.toISOString()}</time>\
${name}</${tag}pt>\n`;
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
        this.#xml += "\t<trk>\n\t\t<name>{0}</name>\n\t\t<trkseg>\n".format(group);
    }
    
    /**
     * Ends a GPX track
     * 
     */
    #endTrack()
    {
        if (this.#curGroup) {
            let name   = "{0}: End Point".format(this.#curGroup);
            this.addWayPoint(Object.assign(exportPoint(this.#lastPoint), {name: name}));
            this.#xml += "\t\t</trkseg>\n\t</trk>\n";
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
     * 
     */
    set dive(dive)
    {
        if (this.#dive) { // Is there a current dive?
            this.#dive.end(); // Stop it!
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
                    me.#logSample(me.#dive);
                }
                else if (me.#dive.ended) {
                    me.dive = null;
                }
            }, SAMPLE_INTERVAL);

            // Adds dive listeners to logger
            dive.addEventListener('start', async (e) => {
                me._write({type: 'site', pos: exportPoint(fus.last.pos)});
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
    #logSample(dive)
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
        let log;
        if (e.type == 'start') {
            log = {
                type: e.type, start: Date.now()
            };
        }
        else if (e.type == 'end') {
            log = {
                type:     e.type,
                maxDepth: Math.rounds(e.target.maxDepth, 2),
                avgDepth: Math.rounds(e.target.avgDepth, 2),
                durSec:   e.target.durSec
            };
            this.#flushEvents();
        }
        else if (e.type == 'event') {
            let detail;
            switch (e.detail) {
                case 'gaschange':
                    detail = {mix: e.target.curMix};
                    break;
                default:
                    return;
            }
            this.#event[e.detail] = detail;
            if (!e.target.durSec) { // Start events logged now!
                this.#logSample(e.target);
                return;
            }
        }
        else if (e.type == 'alert' && e.detail.active) {
            let detail;
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
            this.#event['alert'].push(detail);
        }
        else if (e.type == 'decoadd') {
            this.#event[e.type] = e.detail;
        }
        if (log) {
            this._write(log);
        }
    }

    /**
     * Exports log to a UDDF xml
     * 
     * @returns String
     */
    export()
    {
        let uddf = new UddfWriter();
        let site = null;
        for (let o of this) {
            if (o.type == 'site') {
                site = o.pos;
            }
            else if (o.type == 'start') {
                uddf.startDive({
                    startDate: new Date(o.start)
                }, site);
                site = null;
            }
            else if (o.type == 'end') {
                uddf.endDive(o);
            }
            else if (o.type == 'sample') {
                uddf.addSample(o);
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
    #xml;
    #curGroup;
    #curDive;
    #endInfo;
    #mixes;
    #sites;
    #tanks;

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
        this.#xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n\
<uddf xmlns=\"http://www.streit.cc/uddf/3.2/\" version=\"3.2.0\">\n\
\t<generator><name>DiveTracker</name><datetime>"+(new Date()).toISOString()+"</datetime></generator>\n\
\t<divesite>\n\
\t</divesite>\n\
\t<gasdefinitions>\n\
\t</gasdefinitions>\n\
\t<profiledata>\n";

        this.#curDive  = null;
        this.#curGroup = null;
        this.#endInfo  = null;
        this.#mixes    = {};
        this.#sites    = {};
        this.#tanks    = [];
    }

    /**
     * 
     * @param {Dive} dive
     * @param {Date} dateTime Dive's start date/time
     */
    startDive(dive, pos = null)
    {
        let ts  = dive.startDate.getTime();
        let grp = parseInt(ts / 8640000);
        if (this.#curGroup != grp) {
            this.#openGroup(grp);
        }
        
        let id  = parseInt(ts / 1000);
        if (id != this.#curDive) {
            this.#closeDive();
        }
        
        this.#xml += `\t\t\t<dive id=\"dive${id}\">\n\t\t\t\t<informationbeforedive>`;
        if (pos) {
            this.#xml += `<link ref="${this.#registerSite(pos)}" />`;
        }
        this.#curDive = id;
        this.#xml += `<datetime>${dive.startDate.toISOString()}</datetime>\
</informationbeforedive>\n\t\t\t\t<samples>\n`;
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
        if (!this.#curDive) {
            return;
        }
        
        this.#xml += `\t\t\t\t\t<waypoint><depth>${s.depth}</depth><divetime>${s.time}</divetime>`;
        
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
            this.#xml += `<switchmix ref="${id}" />`;
        }
        if (s.decoadd) {
            let stop = s.decoadd;
            this.#xml += `<decostop kind="${stop.required ? 'mandatory' : 'safety'}" decodepth="${stop.depth}" duration="${stop.sec}"/>`;
        }
        if (s.alert && s.alert[0]) {
            for (let alarm of s.alert) {
                this.#xml += `<alarm>${alarm}</alarm>`;
            }
        }
        this.#xml += "</waypoint>\n";
    }
    
    /**
     * Ends UDDF and returns its contents
     * 
     * @returns string
     */
    end()
    {
        this.#closeDive();
        this.#closeGroup();

        let xml = this.#xml;
        xml += "\t</profiledata>\n</uddf>";

        let sites = '';
        for (let siteId in this.#sites) {
            let site = this.#sites[siteId];
            sites += `\t\t<site id="${siteId}">\
<name>${siteId}</name>\
<geography><latitude>${site.lat}</latitude><longitude>${site.lon}</longitude><timezone>${site.tz}</timezone></geography>\
<sitedata><density>${site.fresh ? '1000' : '1030'}.0</density></sitedata>\
</site>\n`;
        }
        xml = xml.replace(/(<divesite>\n)/i, `$1${sites}`);

        let gases = '';
        for (let mix in this.#mixes) {
            gases += `\t\t<mix id="${mix}"><name>${mix}</name><o2>${this.#mixes[mix].o2}</o2><he>0</he></mix>\n`;
        }
        xml = xml.replace(/(<gasdefinitions>\n)/i, `$1${gases}`);

        this.create();
        return xml;
    }

    /**
     * Appends a end dive XML, if there is one
     */
    #closeDive()
    {
        if (this.#curDive) {
            this.#xml += "\t\t\t\t</samples>\n";
            if (this.#endInfo) {
                this.#xml += `\t\t\t\t<informationafterdive>\
<greatestdepth>${this.#endInfo.maxDepth}</greatestdepth>\
<averagedepth>${this.#endInfo.avgDepth}</averagedepth>\
<diveduration>${this.#endInfo.durSec}</diveduration>\
</informationafterdive>\n`;
                this.#endInfo = null;
            }
            for (let mix of this.#tanks) {
                this.#xml += `\t\t\t\t<tankdata><link ref="${mix}" /></tankdata>\n`;
            }
            this.#tanks = [];
            this.#xml  += "\t\t\t</dive>\n";
            this.#curDive = null;
        }
    }

    /**
     * Appends a new repetition group XML
     *
     * If there is a current group, it will closed
     *
     */
    #openGroup(grp)
    {
        this.#closeGroup();
        this.#xml += `\t\t<repetitiongroup id="rg${grp}">\n`;
        this.#curGroup = grp;
    }

    /**
     * Closes current group if there is one
     *
     */
    #closeGroup()
    {
        if (this.#curGroup) {
            this.#xml += "\t\t</repetitiongroup>\n";
            this.#curGroup = null;
        }
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
        this.#sites[id] = Object.assign({}, pos, {
            tz:    -((new Date()).getTimezoneOffset() / 60),
            fresh: !conf.dc.salt
        });
        return id;
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

export const trackLogger = new TrackLogger();
export const diveLogger = new DiveLogger();

/**
 * Is there logs?
 * 
 * @returns bool
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
