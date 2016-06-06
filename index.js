var fs = require("fs");
var request = require("request");
var Service, Characteristic, DoorState; // set in the module.exports, from homebridge

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;

  homebridge.registerAccessory("homebridge-garagedoor", "GarageDoor", GarageDoorAccessory);
}

function GarageDoorAccessory(log, config) {
  this.log = log;
  this.name = config["name"];
  this.getStateURL = config["getStateURL"];
  this.setStateURL = config["setStateURL"];
  this.accessToken = config["accessToken"];
  this.doorPollInMs = config["doorPollInMs"] || 15000;
  this.doorOpensInSeconds = config["doorOpensInSeconds"] || 15;
  this.initService();

  setTimeout(this.monitorDoorState.bind(this), this.doorPollInMs);
}

GarageDoorAccessory.prototype = {

  monitorDoorState: function() {
     this.getState(function() {
       var isClosed = this.isClosed();
       if (isClosed != this.wasClosed) {
         this.wasClosed = isClosed;
         var state = isClosed ? DoorState.CLOSED : DoorState.OPEN;
         this.log("Door state changed to " + (isClosed ? "CLOSED" : "OPEN"));
         if (!this.operating) {
           this.currentDoorState.setValue(state);
           this.targetDoorState.setValue(state);
           this.targetState = state;
         }
       }
       setTimeout(this.monitorDoorState.bind(this), this.doorPollInMs);
     }.bind(this));
  },

  initService: function() {
    this.garageDoorOpener = new Service.GarageDoorOpener(this.name,this.name);

    this.currentDoorState = this.garageDoorOpener.getCharacteristic(DoorState);
    this.currentDoorState.on('get', this.getState.bind(this));

    this.targetDoorState = this.garageDoorOpener.getCharacteristic(Characteristic.TargetDoorState);
    this.targetDoorState.on('set', this.setState.bind(this));
    this.targetDoorState.on('get', this.getTargetState.bind(this));

    this.getState(function() {
      var isClosed = this.isClosed();

      this.currentDoorState.setValue(isClosed ? DoorState.CLOSED : DoorState.OPEN);
      this.targetDoorState.setValue(isClosed ? DoorState.CLOSED : DoorState.OPEN);

      this.wasClosed = isClosed;
    }.bind(this));

    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Alex Bain")
      .setCharacteristic(Characteristic.Model, "Garage Friend")
      .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");

    this.operating = false;
    setTimeout(this.monitorDoorState.bind(this), this.doorPollInMs);
  },

  getTargetState: function(callback) {
    // TODO: Fix this. Need to set the target state as the opposite of the
    // current state whenever the door is triggered.
    callback(null, this.targetState);
  },

  isClosed: function() {
    return this.isClosed;
  },

  setState: function(state, callback) {
    this.triggerDoor(callback);
  },

  setFinalDoorState: function() {
    this.getState(function() {
      var isClosed = this.isClosed();
      if ((this.targetState == DoorState.CLOSED && !isClosed) || (this.targetState == DoorState.OPEN && isClosed)) {
        this.log("Was trying to " + (this.targetState == DoorState.CLOSED ? " CLOSE " : " OPEN ") + "the door, but it is still " + (isClosed ? "CLOSED":"OPEN"));
        this.currentDoorState.setValue(DoorState.STOPPED);
        this.targetDoorState.setValue(isClosed ? DoorState.CLOSED : DoorState.OPEN);
      } else {
        this.currentDoorState.setValue(this.targetState);
      }
      this.operating = false;
    }.bind(this));
  },

  setState: function(state, callback) {
    this.log("Setting state to " + state);
    this.targetState = state;
    var isClosed = this.isClosed();
    if ((state == DoorState.OPEN && isClosed) || (state == DoorState.CLOSED && !isClosed)) {
        this.log("Triggering GarageDoor Relay");

        this.operating = true;

        if (state == DoorState.OPEN) {
            this.currentDoorState.setValue(DoorState.OPENING);
        } else {
            this.currentDoorState.setValue(DoorState.CLOSING);
        }

        this.triggerDoor(callback);
        setTimeout(this.setFinalDoorState.bind(this), this.doorOpensInSeconds * 1000);

        //fs.writeFileSync("/sys/class/gpio/gpio"+this.doorSwitchPin+"/value", "1");
        //setTimeout(this.switchOff.bind(this), 1000);
    }
  },

  triggerDoor: function(callback) {
    request.post(
        this.setStateURL,
        { form: { access_token: this.accessToken } },
        function (error, response, body) {
          this.log("GarageDoor triggered");
          callback();
        }.bind(this)
    );
  },

  getState: function(callback) {
    request.post(
        this.getStateURL,
        { form: { access_token: this.accessToken } },
        function (error, response, body) {
          // 1 = garage is closed, 0 = garage is open
          this.isClosed = !!body.return_value
          this.log("GarageDoor is " + (this.isClosed ? "CLOSED (" + DoorState.CLOSED + ")" : "OPEN (" + DoorState.OPEN + ")"));
          callback(null, (this.isClosed ? DoorState.CLOSED : DoorState.OPEN));
        }.bind(this)
    );
  },

  getServices: function() {
    return [this.infoService, this.garageDoorOpener];
  }
};
