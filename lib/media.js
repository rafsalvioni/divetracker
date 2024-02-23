

export class Camera
{
    #source;
    #active;

    constructor(el)
    {
        var me = this;
        navigator.mediaDevices.getUserMedia({video: true})
            .then(function (mediaStream) {
                me.#source = el;
                me.#source.srcObject = mediaStream;
                me.#source.play();
                me.#active = true;
            })
            .catch(function (err) {
                console.log('Não há permissões para acessar a webcam');
                me.#source.innerHTML = 'No video';
                me.#active = false;
            });
    }

    get active()
    {
        return this.#active;
    }

    /**
     * 
     * @param {HTMLCanvasElement} canvas 
     */
    takePhoto(canvas)
    {
        canvas.height = this.#source.videoHeight;
        canvas.width  = this.#source.videoWidth;
        var context   = canvas.getContext('2d');
        context.drawImage(this.#source, 0, 0);
        const dataUri = canvas.toDataURL("image/jpeg", .9);
        const name    = `dive-${(new Date()).toISOString()}.jpg`;
        downloadUri(dataUri, name);
    }
}

/**
 * Download a arbitrary data
 * 
 * @param {string} data Contents
 * @param {string} type mime type
 * @param {string} fileName Filename
 */
export function download(data, type, fileName) {
    let blob = new Blob([data], {type});
    let url  = window.URL.createObjectURL(blob);
    downloadUri(url, fileName);
    window.URL.revokeObjectURL(url);
}

/**
 * Download a data URI
 * 
 * @param {string} dataUri DataURL
 * @param {string} fileName Filename
 */
export function downloadUri(dataUri, fileName) {
    let link = document.createElement("a");
    link.download = fileName;
    link.href = dataUri;
    link.click();
}