const v3 = require('node-hue-api').v3
  , hueApi = v3.api 
;

const mic = require('mic');
const EventEmitter = require('events');
const fft = require('fft-js');
const teoria = require('teoria');



class AudioService extends EventEmitter {
  constructor() {
    super(); 
    const micInstance = mic({ 'rate': '16000', 'channels': '1', 'bufferSize': 8 });
    this.microphoneStream = micInstance.getAudioStream();

    this.microphoneStream.on('data', this.processAudioData.bind(this));
    this.microphoneStream.on('startComplete', () => console.log('Microphone stream started.'));
    this.microphoneStream.on('error', error => console.error('Microphone stream error:', error));
    this.microphoneStream.on('stopComplete', () => console.log('Microphone stream stopped.'));
    
    micInstance.start();  

    this.volumeHistory = [];  
    this.volumeHistoryLength = 8;  // Reduce this value to increase system reactivity

  }

  processAudioData(data) {
    console.log("Processing audio data...");

    let volume = 0;
    for(let i = 0; i < data.length; i += 2) { 
        if (i + 1 < data.length) { 
            volume += Math.abs(data.readInt16LE(i));
        }
    }
    volume /= data.length / 2;

    // Perform FFT on the sample data
    let samples = Array.from({length: data.length / 2}, (_, i) => data.readInt16LE(i * 2));
    let phasors = fft.fft(samples);
    let frequencies = fft.util.fftFreq(phasors, 16000); // Sample rate is 16000
    let amplitudes = fft.util.fftMag(phasors);

    // Find the frequency with the highest amplitude
    let maxAmp = Math.max(...amplitudes);
    let maxFreqIndex = amplitudes.findIndex(amp => amp === maxAmp);
    let dominantFrequency = frequencies[maxFreqIndex];

    console.log(`Dominant frequency: ${dominantFrequency} Hz`);
    this.emit('dominantFrequency', dominantFrequency);

    this.volumeHistory.push(volume);
    if (this.volumeHistory.length > this.volumeHistoryLength) {
      this.volumeHistory.shift();  
    }

    let averageVolume = this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length;

    console.log(`Volume: ${averageVolume}`);
    this.emit('volume', averageVolume);
  }



  stop() {
    console.log('Stopping audio service...');
    this.microphoneStream.stop();
  }
}

class HueService {
  constructor(username, ipAddress) {
    this.username = username;
    this.ipAddress = ipAddress;
  }

  async connect() {
    this.API = await hueApi.createLocal(this.ipAddress).connect(this.username);
    this.bridgeConfig = await this.API.configuration.getConfiguration();
    console.log(`Connected to Hue Bridge: ${this.bridgeConfig.name} :: ${this.bridgeConfig.ipaddress}`);
  }


  async getAllLights() {
    const allLights = await this.API.lights.getAll();
    console.log(JSON.stringify(allLights, null, 2));
    allLights.forEach(light => {
        console.log(light.toStringDetailed());
    });
    return allLights;
  }

  async getLightByName(lightName) {
    const light = await this.API.lights.getLightByName(lightName);
    if (light && light.length > 0) {
      console.log(light[0].toStringDetailed());
      return light[0];
    } else {
      console.log(`Failed to find a light with name '${lightName}'`);
      return null;
    }
  }

  async setLightState(lightId, state) {
    const result = await this.API.lights.setLightState(lightId, state);
    console.log(`Light state change was successful? ${result}`);
    return result;
  }

  async cycleColors(lightId, delay = 1000) {
    const colors = [
      { hue: 0, saturation: 254, brightness: 254 },     
      { hue: 21845, saturation: 254, brightness: 254 }, 
      { hue: 43690, saturation: 254, brightness: 254 },
      { hue: 54613, saturation: 254, brightness: 254 },
      { hue: 65535, saturation: 254, brightness: 254 },
      { hue: 43690, saturation: 254, brightness: 254 },
      { hue: 21845, saturation: 254, brightness: 254 },
      { hue: 21845, saturation: 254, brightness: 254 },
    ];

    for (let color of colors) {
      await this.setLightState(lightId, color);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } 

  async gradualChange(lightId, startState, endState, steps, delay = 1000) {
    const stepChange = {
      hue: (endState.hue - startState.hue) / steps,
      saturation: (endState.saturation - startState.saturation) / steps,
      brightness: (endState.brightness - startState.brightness) / steps
    };

    let currentState = {...startState};

    for (let i = 0; i < steps; i++) {
      currentState.hue += stepChange.hue;
      currentState.saturation += stepChange.saturation;
      currentState.brightness += stepChange.brightness;
      await this.setLightState(lightId, currentState);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async artLightShow(lightId) {
    const startState = { hue: 10000, saturation: 75, brightness: 50 }; 
    const endState = { hue: 43690, saturation: 254, brightness: 254 }; 
    await this.gradualChange(lightId, startState, endState, 30, 500);  
  }

  async connectAudio(audioService) {
    this.audioService = audioService;
    this.audioService.on('volume', this.handleVolume.bind(this));
    this.audioService.on('dominantFrequency', this.handleDominantFrequency.bind(this));

    this.lightState1 = {on: true, hue: 0, bri: 0};
    this.lightState2 = {on: true, hue: 0, bri: 0};

  }
  

  handleVolume(volume) {
    const MIN_VOLUME = 70;  // Define your minimum volume here
    const MAX_VOLUME = 3000;  // Define your maximum volume here
  
    const MIN_BRIGHTNESS = Math.round(254 * 0.05);  // 5% of max brightness
    const MAX_BRIGHTNESS = 254;
  
    let volumeRange = MAX_VOLUME - MIN_VOLUME;
    let brightnessRange = MAX_BRIGHTNESS - MIN_BRIGHTNESS;
  
    let volumeNormalized = Math.min(Math.max((volume - MIN_VOLUME) / volumeRange, 0), 1);
  
    let brightness = Math.round(volumeNormalized * brightnessRange + MIN_BRIGHTNESS);
    this.setLightState(2, {on: true, bri: brightness});

    this.lightState2.bri = brightness;
    this.setLightState(1, this.lightState2);  // Assuming light 2 has the ID 3
  }

  handleDominantFrequency(frequency) {
    let noteObject = teoria.note.fromFrequency(frequency);

    let noteWithOctave = noteObject.note.scientific()
    let note = noteWithOctave.split(/(\d+)/)[0];  

    console.log(`Handling dominant frequency: ${frequency} Hz, Note: ${note}`);

    const NOTE_COLORS = {
      'C': 65535,     // Soft red
      'C#': 6000,     // Warm orange
      'D': 12000,     // Gold
      'D#': 17500,    // Light green
      'E': 22000,     // Soft green
      'F': 26500,     // Turquoise
      'F#': 31000,    // Light blue
      'G': 35500,     // Soft blue
      'G#': 40000,    // Lavender
      'A': 44500,     // Light pink
      'A#': 50000,    // Soft pink
      'B': 55000,     // Rose
    };

    // const NOTE_COLORS = {
    //     'C': 0,     // Red
    //     'C#': 9000, // Orange
    //     'D': 12000, // Yellow
    //     'D#': 18000, // Light green
    //     'E': 24000, // Green
    //     'F': 30000, // Light blue
    //     'F#': 36000, // Sky blue
    //     'G': 42000, // Blue
    //     'G#': 48000, // Purple
    //     'A': 54000, // Pink
    //     'A#': 60000, // Rose
    //     'B': 65535 // Crimson
    // };
  
    let color = NOTE_COLORS[note];
    if (color !== undefined) {
        this.setLightState(2, {on: true, hue: color});
    }
  }

}

async function test() {
  const hueService = new HueService("GesIZHgaAc4JF1BppESBpNg7D9Kk7LFtvAUiHCGr", "192.168.1.2");
  const audioService = new AudioService();

  await hueService.connect();
  await hueService.connectAudio(audioService);

  // Don't forget to stop the audio service when you're done
  // audioService.stop();
}


test();






// async function test() {
//   const hueService = new HueService("GesIZHgaAc4JF1BppESBpNg7D9Kk7LFtvAUiHCGr", "192.168.1.2");
//   await hueService.connect();
//   await hueService.artLightShow(2);
// } 





// const v3 = require('node-hue-api').v3
//   , hueApi = v3.api 
// ;

// async function  test() {

//   const username =  "GesIZHgaAc4JF1BppESBpNg7D9Kk7LFtvAUiHCGr"
//   const ipAddress = "192.168.1.2"
//   const API = await hueApi.createLocal(ipAddress).connect(username);
  
//   const bridgeConfig = await API.configuration.getConfiguration();
//   console.log(`Connected to Hue Bridge: ${bridgeConfig.name} :: ${bridgeConfig.ipaddress}`);
  
//   console.log("bridgeConfig", bridgeConfig) 

//   // Fetch and log all lights
//   const allLights = await API.lights.getAll();
//   console.log(JSON.stringify(allLights, null, 2));
//   allLights.forEach(light => {
//       console.log(light.toStringDetailed());
//   });
// }

// test().then(
//   resp => console.log(resp)
// )







// const v3 = require('node-hue-api').v3
//   , discovery = v3.discovery
//   , hueApi = v3.api 
// ;

// async function  test() {

//   const username =  "GesIZHgaAc4JF1BppESBpNg7D9Kk7LFtvAUiHCGr"
//   const ipAddress = "192.168.1.2"
//   const API = await hueApi.createLocal(ipAddress).connect(username);
  
//   const bridgeConfig = await API.configuration.getConfiguration();
//   console.log(`Connected to Hue Bridge: ${bridgeConfig.name} :: ${bridgeConfig.ipaddress}`);
  
//   console.log("bridgeConfig", bridgeConfig) 
// }

// test().then(
//   resp => console.log(resp)
// )










// const appName = 'node-hue-api';
// const deviceName = 'example-code';
// let API;

// const lightState = v3.lightStates.LightState.create().on().rgb(color.r, color.g, color.b);



  // async function discoverBridge() {
  //     const discoveryResults = await v3.discovery.nupnpSearch();

  //   if (discoveryResults.length === 0) {
  //     console.error('Failed to resolve any Hue Bridges');
  //     return null;
  //   } else {
  //     return discoveryResults[0].ipaddress;
  //   }
  // }

// async function discoverAndCreateUser() {
//   const ipAddress = await discoverBridge();

//   const unauthenticatedApi = await hueApi.createLocal(ipAddress).connect();
  
//   let createdUser;
//   try {
//     createdUser = await unauthenticatedApi.users.createUser(appName, deviceName);

//     console.log(`Hue Bridge User: ${createdUser.username}`);
//     console.log(`Hue Bridge User Client Key: ${createdUser.clientkey}`);

//     // Hue Bridge User: GesIZHgaAc4JF1BppESBpNg7D9Kk7LFtvAUiHCGr
//     // Hue Bridge User Client Key: 5FCC915C5D944A4743E38B36B4ED9D8B

//     API = await hueApi.createLocal(ipAddress).connect(createdUser.username);

//     const bridgeConfig = await API.configuration.getConfiguration();
//     console.log(`Connected to Hue Bridge: ${bridgeConfig.name} :: ${bridgeConfig.ipaddress}`);

//   } catch(err) {
//     if (err.getHueErrorType() === 101) {
//       console.error('The Link button on the bridge was not pressed. Please press the Link button and try again.');
//     } else {
//       console.error(`Unexpected Error: ${err.message}`);
//     }
//   }
// }

// async function turnOnLight(lightId, color) {
//   const test = new v3.lightStates.LightState();
//   test.on().rgb(255, 0, 0);
//   // const lightState = v3.lightStates.LightState.create().on().rgb(color.r, color.g, color.b);
//   // try {
//   //   await API.lights.setLightState(lightId, lightState);
//   // } catch(err) {
//   //   console.error(`Error al cambiar el estado de la luz: ${err}`);
//   // }
// }
// discoverAndCreateUser();

// turnOnLight(1, "red"); // Encender la luz con el color determinado


/*
detectar el tono de lo que está sonando. en base al tono mostrar un color. sol en aranajando, do en azul, etc.
*/