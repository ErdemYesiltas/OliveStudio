import {Ticker} from 'pixi.js';
/** Public Ticker API only: no started/shared ticker, one simulation timestamp. */
export class SimulationTicker{
 readonly ticker=new Ticker();private milliseconds=0;
 constructor(){this.ticker.autoStart=false;this.ticker.minFPS=0;this.ticker.maxFPS=0;this.ticker.update(0);}
 advance(seconds:number){if(!Number.isFinite(seconds)||seconds<=0)throw Error('Positive finite simulation delta required');this.milliseconds+=seconds*1000;this.ticker.update(this.milliseconds);}
 dispose(){this.ticker.destroy();}
}
