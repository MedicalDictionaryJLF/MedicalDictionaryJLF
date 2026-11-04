// Short local technique cues, deliberately not represented as diagnostic patient recordings.
let context;
export async function playBedsideAudio(technique, siteId) {
  if (!['auscultate','percuss'].includes(technique)) return false;
  const AudioContextType=globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextType) return false;
  context ||= new AudioContextType();
  await context.resume();
  const now=context.currentTime;
  const tone=(frequency,start,duration,gain=.05)=>{
    const oscillator=context.createOscillator(),volume=context.createGain();
    oscillator.type='sine';oscillator.frequency.value=frequency;
    volume.gain.setValueAtTime(.0001,start);volume.gain.exponentialRampToValueAtTime(gain,start+.012);
    volume.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(volume).connect(context.destination);oscillator.start(start);oscillator.stop(start+duration+.02);
  };
  if(technique==='percuss'){
    tone(siteId.startsWith('abdomen')?160:115,now,.19,.06);
  }else if(siteId.startsWith('heart')){
    tone(82,now,.12,.055);tone(105,now+.2,.09,.04);tone(82,now+.85,.12,.055);tone(105,now+1.05,.09,.04);
  }else if(siteId.startsWith('lung')){
    const length=Math.floor(context.sampleRate*1.25),buffer=context.createBuffer(1,length,context.sampleRate),samples=buffer.getChannelData(0);
    for(let i=0;i<length;i++)samples[i]=(Math.random()*2-1)*Math.sin(Math.PI*i/length)*.09;
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),volume=context.createGain();
    source.buffer=buffer;filter.type='lowpass';filter.frequency.value=650;volume.gain.value=.3;
    source.connect(filter).connect(volume).connect(context.destination);source.start(now);
  }else{
    for(const offset of [.1,.38,.7,1.02])tone(170+offset*90,now+offset,.045,.025);
  }
  return true;
}

export function closeBedsideAudio(){if(context){context.close().catch(()=>{});context=null;}}
