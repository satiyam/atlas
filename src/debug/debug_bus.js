const { EventEmitter } = require('events')
class DebugBus extends EventEmitter {}
const bus = new DebugBus()
bus.setMaxListeners(50)
module.exports = bus
