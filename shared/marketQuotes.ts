export type RubberQuote = {
  contract:string;
  lastPrice:number;
  previousSettlement:number|null;
  change:number|null;
  changePct:number|null;
  volumeLots:number|null;
  openInterestLots:number|null;
};

export type RubberMarketQuotes = {
  status:'available'|'stale'|'unavailable'|'offline';
  mode:'delayed'|'daily';
  provider:string;
  sourceUrl:string;
  delayMinutes:number|null;
  quoteAt:string|null;
  fetchedAt:string|null;
  tradeDate:string|null;
  quotes:RubberQuote[];
  message?:string;
};
