(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

module.exports = function (player) {
  /**
   * Adds a listener of an event
   * @chainable
   * @param {String} event - the event name
   * @param {Function} callback - the event handler
   * @return {SamplePlayer} the player
   * @example
   * player.on('start', function(time, note) {
   *   console.log(time, note)
   * })
   */
  player.on = function (event, cb) {
    if (arguments.length === 1 && typeof event === 'function') return player.on('event', event)
    var prop = 'on' + event
    var old = player[prop]
    player[prop] = old ? chain(old, cb) : cb
    return player
  }
  return player
}

function chain (fn1, fn2) {
  return function (a, b, c, d) { fn1(a, b, c, d); fn2(a, b, c, d) }
}

},{}],2:[function(require,module,exports){
'use strict'

var player = require('./player')
var events = require('./events')
var notes = require('./notes')
var scheduler = require('./scheduler')
var midi = require('./midi')

function SamplePlayer (ac, source, options) {
  return midi(scheduler(notes(events(player(ac, source, options)))))
}

if (typeof module === 'object' && module.exports) module.exports = SamplePlayer
if (typeof window !== 'undefined') window.SamplePlayer = SamplePlayer

},{"./events":1,"./midi":3,"./notes":4,"./player":5,"./scheduler":6}],3:[function(require,module,exports){
var midimessage = require('midimessage')

module.exports = function (player) {
  /**
  * Connect a player to a midi input
  *
  * The options accepts:
  *
  * - channel: the channel to listen to. Listen to all channels by default.
  *
  * @param {MIDIInput} input
  * @param {Object} options - (Optional)
  * @return {SamplePlayer} the player
  * @example
  * var piano = player(...)
  * window.navigator.requestMIDIAccess().then(function (midiAccess) {
  *   midiAccess.inputs.forEach(function (midiInput) {
  *     piano.listenToMidi(midiInput)
  *   })
  * })
  */
  player.listenToMidi = function (input, options) {
    var started = {}
    var opts = options || {}
    var gain = opts.gain || function (vel) { return vel / 127 }

    input.onmidimessage = function (msg) {
      var mm = msg.messageType ? msg : midimessage(msg)
      if (mm.messageType === 'noteon' && mm.velocity === 0) {
        mm.messageType = 'noteoff'
      }
      if (opts.channel && mm.channel !== opts.channel) return

      switch (mm.messageType) {
        case 'noteon':
          started[mm.key] = player.play(mm.key, 0, { gain: gain(mm.velocity) })
          break
        case 'noteoff':
          if (started[mm.key]) {
            started[mm.key].stop()
            delete started[mm.key]
          }
          break
      }
    }
    return player
  }
  return player
}

},{"midimessage":8}],4:[function(require,module,exports){
'use strict'

var note = require('note-parser')
var isMidi = function (n) { return n !== null && n !== [] && n >= 0 && n < 129 }
var toMidi = function (n) { return isMidi(n) ? +n : note.midi(n) }

// Adds note name to midi conversion
module.exports = function (player) {
  if (player.buffers) {
    var map = player.opts.map
    var toKey = typeof map === 'function' ? map : toMidi
    var mapper = function (name) {
      return name ? toKey(name) || name : null
    }

    player.buffers = mapBuffers(player.buffers, mapper)
    var start = player.start
    player.start = function (name, when, options) {
      var key = mapper(name)
      var dec = key % 1
      if (dec) {
        key = Math.floor(key)
        options = Object.assign(options || {}, { cents: Math.floor(dec * 100) })
      }
      return start(key, when, options)
    }
  }
  return player
}

function mapBuffers (buffers, toKey) {
  return Object.keys(buffers).reduce(function (mapped, name) {
    mapped[toKey(name)] = buffers[name]
    return mapped
  }, {})
}

},{"note-parser":9}],5:[function(require,module,exports){
/* global AudioBuffer */
'use strict'

var ADSR = require('adsr')

var EMPTY = {}
var DEFAULTS = {
  gain: 1,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.9,
  release: 0.3,
  loop: false,
  cents: 0,
  loopStart: 0,
  loopEnd: 0
}

/**
 * Create a sample player.
 *
 * @param {AudioContext} ac - the audio context
 * @param {ArrayBuffer|Object<String,ArrayBuffer>} source
 * @param {Onject} options - (Optional) an options object
 * @return {player} the player
 * @example
 * var SamplePlayer = require('sample-player')
 * var ac = new AudioContext()
 * var snare = SamplePlayer(ac, <AudioBuffer>)
 * snare.play()
 */
function SamplePlayer (ac, source, options) {
  var connected = false
  var nextId = 0
  var tracked = {}
  var out = ac.createGain()
  out.gain.value = 1

  var opts = Object.assign({}, DEFAULTS, options)

  /**
   * @namespace
   */
  var player = { context: ac, out: out, opts: opts }
  if (source instanceof AudioBuffer) player.buffer = source
  else player.buffers = source

  /**
   * Start a sample buffer.
   *
   * The returned object has a function `stop(when)` to stop the sound.
   *
   * @param {String} name - the name of the buffer. If the source of the
   * SamplePlayer is one sample buffer, this parameter is not required
   * @param {Float} when - (Optional) when to start (current time if by default)
   * @param {Object} options - additional sample playing options
   * @return {AudioNode} an audio node with a `stop` function
   * @example
   * var sample = player(ac, <AudioBuffer>).connect(ac.destination)
   * sample.start()
   * sample.start(5, { gain: 0.7 }) // name not required since is only one AudioBuffer
   * @example
   * var drums = player(ac, { snare: <AudioBuffer>, kick: <AudioBuffer>, ... }).connect(ac.destination)
   * drums.start('snare')
   * drums.start('snare', 0, { gain: 0.3 })
   */
  player.start = function (name, when, options) {
    // if only one buffer, reorder arguments
    if (player.buffer && name !== null) return player.start(null, name, when)

    var buffer = name ? player.buffers[name] : player.buffer
    if (!buffer) {
      console.warn('Buffer ' + name + ' not found.')
      return
    } else if (!connected) {
      console.warn('SamplePlayer not connected to any node.')
      return
    }

    var opts = options || EMPTY
    when = Math.max(ac.currentTime, when || 0)
    player.emit('start', when, name, opts)
    var node = createNode(name, buffer, opts)
    node.id = track(name, node)
    node.env.start(when)
    node.source.start(when)
    player.emit('started', when, node.id, node)
    if (opts.duration) node.stop(when + opts.duration)
    return node
  }

  // NOTE: start will be override so we can't copy the function reference
  // this is obviously not a good design, so this code will be gone soon.
  /**
   * An alias for `player.start`
   * @see player.start
   * @since 0.3.0
   */
  player.play = function (name, when, options) {
    return player.start(name, when, options)
  }

  /**
   * Stop some or all samples
   *
   * @param {Float} when - (Optional) an absolute time in seconds (or currentTime
   * if not specified)
   * @param {Array} nodes - (Optional) an array of nodes or nodes ids to stop
   * @return {Array} an array of ids of the stoped samples
   *
   * @example
   * var longSound = player(ac, <AudioBuffer>).connect(ac.destination)
   * longSound.start(ac.currentTime)
   * longSound.start(ac.currentTime + 1)
   * longSound.start(ac.currentTime + 2)
   * longSound.stop(ac.currentTime + 3) // stop the three sounds
   */
  player.stop = function (when, ids) {
    var node
    ids = ids || Object.keys(tracked)
    return ids.map(function (id) {
      node = tracked[id]
      if (!node) return null
      node.stop(when)
      return node.id
    })
  }
  /**
   * Connect the player to a destination node
   *
   * @param {AudioNode} destination - the destination node
   * @return {AudioPlayer} the player
   * @chainable
   * @example
   * var sample = player(ac, <AudioBuffer>).connect(ac.destination)
   */
  player.connect = function (dest) {
    connected = true
    out.connect(dest)
    return player
  }

  player.emit = function (event, when, obj, opts) {
    if (player.onevent) player.onevent(event, when, obj, opts)
    var fn = player['on' + event]
    if (fn) fn(when, obj, opts)
  }

  return player

  // =============== PRIVATE FUNCTIONS ============== //

  function track (name, node) {
    node.id = nextId++
    tracked[node.id] = node
    node.source.onended = function () {
      var now = ac.currentTime
      node.source.disconnect()
      node.env.disconnect()
      node.disconnect()
      player.emit('ended', now, node.id, node)
    }
    return node.id
  }

  function createNode (name, buffer, options) {
    var node = ac.createGain()
    var pan = ac.createStereoPanner()
    node.gain.value = 0 // the envelope will control the gain
    node.connect(out)

    pan.pan.setValueAtTime(options.pan || 0, ac.currentTime);
    node.env = envelope(ac, options, opts)
    node.env.connect(node.gain)

    node.source = ac.createBufferSource()
    node.source.buffer = buffer
    node.source.connect(pan)
    pan.connect(node)
    node.source.loop = options.loop || opts.loop
    node.source.playbackRate.value = centsToRate(options.cents || opts.cents)
    node.source.loopStart = options.loopStart || opts.loopStart
    node.source.loopEnd = options.loopEnd || opts.loopEnd
    node.stop = function (when) {
      var time = when || ac.currentTime
      player.emit('stop', time, name)
      var stopAt = node.env.stop(time)
      node.source.stop(stopAt)
    }
    return node
  }
}

function isNum (x) { return typeof x === 'number' }
var PARAMS = ['attack', 'decay', 'sustain', 'release']
function envelope (ac, options, opts) {
  var env = ADSR(ac)
  var adsr = options.adsr || opts.adsr
  PARAMS.forEach(function (name, i) {
    if (adsr) env[name] = adsr[i]
    else env[name] = options[name] || opts[name]
  })
  env.value.value = isNum(options.gain) ? options.gain
    : isNum(opts.gain) ? opts.gain : 1
  return env
}

/*
 * Get playback rate for a given pitch change (in cents)
 * Basic [math](http://www.birdsoft.demon.co.uk/music/samplert.htm):
 * f2 = f1 * 2^( C / 1200 )
 */
function centsToRate (cents) { return cents ? Math.pow(2, cents / 1200) : 1 }

module.exports = SamplePlayer

},{"adsr":7}],6:[function(require,module,exports){
'use strict'

var isArr = Array.isArray
var isObj = function (o) { return o && typeof o === 'object' }
var OPTS = {}

module.exports = function (player) {
  /**
   * Schedule a list of events to be played at specific time.
   *
   * It supports three formats of events for the events list:
   *
   * - An array with [time, note]
   * - An array with [time, object]
   * - An object with { time: ?, [name|note|midi|key]: ? }
   *
   * @param {Float} time - an absolute time to start (or AudioContext's
   * currentTime if provided number is 0)
   * @param {Array} events - the events list.
   * @return {Array} an array of ids
   *
   * @example
   * // Event format: [time, note]
   * var piano = player(ac, ...).connect(ac.destination)
   * piano.schedule(0, [ [0, 'C2'], [0.5, 'C3'], [1, 'C4'] ])
   *
   * @example
   * // Event format: an object { time: ?, name: ? }
   * var drums = player(ac, ...).connect(ac.destination)
   * drums.schedule(0, [
   *   { name: 'kick', time: 0 },
   *   { name: 'snare', time: 0.5 },
   *   { name: 'kick', time: 1 },
   *   { name: 'snare', time: 1.5 }
   * ])
   */
  player.schedule = function (time, events) {
    var now = player.context.currentTime
    var when = time < now ? now : time
    player.emit('schedule', when, events)
    var t, o, note, opts
    return events.map(function (event) {
      if (!event) return null
      else if (isArr(event)) {
        t = event[0]; o = event[1]
      } else {
        t = event.time; o = event
      }

      if (isObj(o)) {
        note = o.name || o.key || o.note || o.midi || null
        opts = o
      } else {
        note = o
        opts = OPTS
      }

      return player.start(note, when + (t || 0), opts)
    })
  }
  return player
}

},{}],7:[function(require,module,exports){
module.exports = ADSR

function ADSR(audioContext){
  var node = audioContext.createGain()

  var voltage = node._voltage = getVoltage(audioContext)
  var value = scale(voltage)
  var startValue = scale(voltage)
  var endValue = scale(voltage)

  node._startAmount = scale(startValue)
  node._endAmount = scale(endValue)

  node._multiplier = scale(value)
  node._multiplier.connect(node)
  node._startAmount.connect(node)
  node._endAmount.connect(node)

  node.value = value.gain
  node.startValue = startValue.gain
  node.endValue = endValue.gain

  node.startValue.value = 0
  node.endValue.value = 0

  Object.defineProperties(node, props)
  return node
}

var props = {

  attack: { value: 0, writable: true },
  decay: { value: 0, writable: true },
  sustain: { value: 1, writable: true },
  release: {value: 0, writable: true },

  getReleaseDuration: {
    value: function(){
      return this.release
    }
  },

  start: {
    value: function(at){
      var target = this._multiplier.gain
      var startAmount = this._startAmount.gain
      var endAmount = this._endAmount.gain

      this._voltage.start(at)
      this._decayFrom = this._decayFrom = at+this.attack
      this._startedAt = at

      var sustain = this.sustain

      target.cancelScheduledValues(at)
      startAmount.cancelScheduledValues(at)
      endAmount.cancelScheduledValues(at)

      endAmount.setValueAtTime(0, at)

      if (this.attack){
        target.setValueAtTime(0, at)
        target.linearRampToValueAtTime(1, at + this.attack)

        startAmount.setValueAtTime(1, at)
        startAmount.linearRampToValueAtTime(0, at + this.attack)
      } else {
        target.setValueAtTime(1, at)
        startAmount.setValueAtTime(0, at)
      }

      if (this.decay){
        target.setTargetAtTime(sustain, this._decayFrom, getTimeConstant(this.decay))
      }
    }
  },

  stop: {
    value: function(at, isTarget){
      if (isTarget){
        at = at - this.release
      }

      var endTime = at + this.release
      if (this.release){

        var target = this._multiplier.gain
        var startAmount = this._startAmount.gain
        var endAmount = this._endAmount.gain

        target.cancelScheduledValues(at)
        startAmount.cancelScheduledValues(at)
        endAmount.cancelScheduledValues(at)

        var expFalloff = getTimeConstant(this.release)

        // truncate attack (required as linearRamp is removed by cancelScheduledValues)
        if (this.attack && at < this._decayFrom){
          var valueAtTime = getValue(0, 1, this._startedAt, this._decayFrom, at)
          target.linearRampToValueAtTime(valueAtTime, at)
          startAmount.linearRampToValueAtTime(1-valueAtTime, at)
          startAmount.setTargetAtTime(0, at, expFalloff)
        }

        endAmount.setTargetAtTime(1, at, expFalloff)
        target.setTargetAtTime(0, at, expFalloff)
      }

      this._voltage.stop(endTime)
      return endTime
    }
  },

  onended: {
    get: function(){
      return this._voltage.onended
    },
    set: function(value){
      this._voltage.onended = value
    }
  }

}

var flat = new Float32Array([1,1])
function getVoltage(context){
  var voltage = context.createBufferSource()
  var buffer = context.createBuffer(1, 2, context.sampleRate)
  buffer.getChannelData(0).set(flat)
  voltage.buffer = buffer
  voltage.loop = true
  return voltage
}

function scale(node){
  var gain = node.context.createGain()
  node.connect(gain)
  return gain
}

function getTimeConstant(time){
  return Math.log(time+1)/Math.log(100)
}

function getValue(start, end, fromTime, toTime, at){
  var difference = end - start
  var time = toTime - fromTime
  var truncateTime = at - fromTime
  var phase = truncateTime / time
  var value = start + phase * difference

  if (value <= start) {
      value = start
  }
  if (value >= end) {
      value = end
  }

  return value
}

},{}],8:[function(require,module,exports){
(function (global){
(function(e){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=e()}else if(typeof define==="function"&&define.amd){define([],e)}else{var t;if(typeof window!=="undefined"){t=window}else if(typeof global!=="undefined"){t=global}else if(typeof self!=="undefined"){t=self}else{t=this}t.midimessage=e()}})(function(){var e,t,s;return function o(e,t,s){function a(n,i){if(!t[n]){if(!e[n]){var l=typeof require=="function"&&require;if(!i&&l)return l(n,!0);if(r)return r(n,!0);var h=new Error("Cannot find module '"+n+"'");throw h.code="MODULE_NOT_FOUND",h}var c=t[n]={exports:{}};e[n][0].call(c.exports,function(t){var s=e[n][1][t];return a(s?s:t)},c,c.exports,o,e,t,s)}return t[n].exports}var r=typeof require=="function"&&require;for(var n=0;n<s.length;n++)a(s[n]);return a}({1:[function(e,t,s){"use strict";Object.defineProperty(s,"__esModule",{value:true});s["default"]=function(e){function t(e){this._event=e;this._data=e.data;this.receivedTime=e.receivedTime;if(this._data&&this._data.length<2){console.warn("Illegal MIDI message of length",this._data.length);return}this._messageCode=e.data[0]&240;this.channel=e.data[0]&15;switch(this._messageCode){case 128:this.messageType="noteoff";this.key=e.data[1]&127;this.velocity=e.data[2]&127;break;case 144:this.messageType="noteon";this.key=e.data[1]&127;this.velocity=e.data[2]&127;break;case 160:this.messageType="keypressure";this.key=e.data[1]&127;this.pressure=e.data[2]&127;break;case 176:this.messageType="controlchange";this.controllerNumber=e.data[1]&127;this.controllerValue=e.data[2]&127;if(this.controllerNumber===120&&this.controllerValue===0){this.channelModeMessage="allsoundoff"}else if(this.controllerNumber===121){this.channelModeMessage="resetallcontrollers"}else if(this.controllerNumber===122){if(this.controllerValue===0){this.channelModeMessage="localcontroloff"}else{this.channelModeMessage="localcontrolon"}}else if(this.controllerNumber===123&&this.controllerValue===0){this.channelModeMessage="allnotesoff"}else if(this.controllerNumber===124&&this.controllerValue===0){this.channelModeMessage="omnimodeoff"}else if(this.controllerNumber===125&&this.controllerValue===0){this.channelModeMessage="omnimodeon"}else if(this.controllerNumber===126){this.channelModeMessage="monomodeon"}else if(this.controllerNumber===127){this.channelModeMessage="polymodeon"}break;case 192:this.messageType="programchange";this.program=e.data[1];break;case 208:this.messageType="channelpressure";this.pressure=e.data[1]&127;break;case 224:this.messageType="pitchbendchange";var t=e.data[2]&127;var s=e.data[1]&127;this.pitchBend=(t<<8)+s;break}}return new t(e)};t.exports=s["default"]},{}]},{},[1])(1)});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],9:[function(require,module,exports){
'use strict'

var REGEX = /^([a-gA-G])(#{1,}|b{1,}|x{1,}|)(-?\d*)\s*(.*)\s*$/
/**
 * A regex for matching note strings in scientific notation.
 *
 * @name regex
 * @function
 * @return {RegExp} the regexp used to parse the note name
 *
 * The note string should have the form `letter[accidentals][octave][element]`
 * where:
 *
 * - letter: (Required) is a letter from A to G either upper or lower case
 * - accidentals: (Optional) can be one or more `b` (flats), `#` (sharps) or `x` (double sharps).
 * They can NOT be mixed.
 * - octave: (Optional) a positive or negative integer
 * - element: (Optional) additionally anything after the duration is considered to
 * be the element name (for example: 'C2 dorian')
 *
 * The executed regex contains (by array index):
 *
 * - 0: the complete string
 * - 1: the note letter
 * - 2: the optional accidentals
 * - 3: the optional octave
 * - 4: the rest of the string (trimmed)
 *
 * @example
 * var parser = require('note-parser')
 * parser.regex.exec('c#4')
 * // => ['c#4', 'c', '#', '4', '']
 * parser.regex.exec('c#4 major')
 * // => ['c#4major', 'c', '#', '4', 'major']
 * parser.regex().exec('CMaj7')
 * // => ['CMaj7', 'C', '', '', 'Maj7']
 */
function regex () { return REGEX }

var SEMITONES = [0, 2, 4, 5, 7, 9, 11]
/**
 * Parse a note name in scientific notation an return it's components,
 * and some numeric properties including midi number and frequency.
 *
 * @name parse
 * @function
 * @param {String} note - the note string to be parsed
 * @param {Boolean} isTonic - true if the note is the tonic of something.
 * If true, en extra tonicOf property is returned. It's false by default.
 * @param {Float} tunning - The frequency of A4 note to calculate frequencies.
 * By default it 440.
 * @return {Object} the parsed note name or null if not a valid note
 *
 * The parsed note name object will ALWAYS contains:
 * - letter: the uppercase letter of the note
 * - acc: the accidentals of the note (only sharps or flats)
 * - pc: the pitch class (letter + acc)
 * - step: s a numeric representation of the letter. It's an integer from 0 to 6
 * where 0 = C, 1 = D ... 6 = B
 * - alt: a numeric representation of the accidentals. 0 means no alteration,
 * positive numbers are for sharps and negative for flats
 * - chroma: a numeric representation of the pitch class. It's like midi for
 * pitch classes. 0 = C, 1 = C#, 2 = D ... It can have negative values: -1 = Cb.
 * Can detect pitch class enhramonics.
 *
 * If the note has octave, the parser object will contain:
 * - oct: the octave number (as integer)
 * - midi: the midi number
 * - freq: the frequency (using tuning parameter as base)
 *
 * If the parameter `isTonic` is set to true, the parsed object will contain:
 * - tonicOf: the rest of the string that follows note name (left and right trimmed)
 *
 * @example
 * var parse = require('note-parser').parse
 * parse('Cb4')
 * // => { letter: 'C', acc: 'b', pc: 'Cb', step: 0, alt: -1, chroma: -1,
 *         oct: 4, midi: 59, freq: 246.94165062806206 }
 * // if no octave, no midi, no freq
 * parse('fx')
 * // => { letter: 'F', acc: '##', pc: 'F##', step: 3, alt: 2, chroma: 7 })
 */
function parse (str, isTonic, tuning) {
  if (typeof str !== 'string') return null
  var m = REGEX.exec(str)
  if (!m || !isTonic && m[4]) return null

  var p = { letter: m[1].toUpperCase(), acc: m[2].replace(/x/g, '##') }
  p.pc = p.letter + p.acc
  p.step = (p.letter.charCodeAt(0) + 3) % 7
  p.alt = p.acc[0] === 'b' ? -p.acc.length : p.acc.length
  p.chroma = SEMITONES[p.step] + p.alt
  if (m[3]) {
    p.oct = +m[3]
    p.midi = p.chroma + 12 * (p.oct + 1)
    p.freq = midiToFreq(p.midi, tuning)
  }
  if (isTonic) p.tonicOf = m[4]
  return p
}

/**
 * Given a midi number, return its frequency
 * @param {Integer} midi - midi note number
 * @param {Float} tuning - (Optional) the A4 tuning (440Hz by default)
 * @return {Float} frequency in hertzs
 */
function midiToFreq (midi, tuning) {
  return Math.pow(2, (midi - 69) / 12) * (tuning || 440)
}

var parser = { parse: parse, regex: regex, midiToFreq: midiToFreq }
var FNS = ['letter', 'acc', 'pc', 'step', 'alt', 'chroma', 'oct', 'midi', 'freq']
FNS.forEach(function (name) {
  parser[name] = function (src) {
    var p = parse(src)
    return p && (typeof p[name] !== 'undefined') ? p[name] : null
  }
})

module.exports = parser

// extra API docs
/**
 * Get midi of a note
 *
 * @name midi
 * @function
 * @param {String} note - the note name
 * @return {Integer} the midi number of the note or null if not a valid note
 * or the note does NOT contains octave
 * @example
 * var parser = require('note-parser')
 * parser.midi('A4') // => 69
 * parser.midi('A') // => null
 */
/**
 * Get freq of a note in hertzs (in a well tempered 440Hz A4)
 *
 * @name freq
 * @function
 * @param {String} note - the note name
 * @return {Float} the freq of the number if hertzs or null if not valid note
 * or the note does NOT contains octave
 * @example
 * var parser = require('note-parser')
 * parser.freq('A4') // => 440
 * parser.freq('A') // => null
 */

},{}]},{},[2]);
