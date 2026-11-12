const main = document.querySelector('#main');
const current = location.pathname;
const wallet = document.querySelector('#wallet');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
for (const a of document.querySelectorAll('nav a')) if (a.pathname === current) a.setAttribute('aria-current','page');
wallet.addEventListener('click',async () => {
  const provider = window.phantom?.solana ?? window.solana;
  if (!provider?.connect) { wallet.textContent = 'Wallet not detected'; return; }
  try {
    const result = await provider.connect();
    const key = result.publicKey.toString();
    const field = document.querySelector('[name=creatorWallet]');
    if (field) field.value = key;
    wallet.textContent = key.slice(0,5)+'…'+key.slice(-4);
  } catch { wallet.textContent = 'Connect wallet'; }
});
const html = (s) => { main.innerHTML = s; };
const page = (eyebrow,title,desc,content) =>
  '<section class="page"><span class="eyebrow">'+eyebrow+'</span><h1>'+title+'</h1><p>'+desc+'</p>'+content+'</section>';
const notice = '<div class="notice">Development build · Funded does not submit launches, swaps, bridges, or payouts.</div>';
const sender = '<div class="callout"><strong>Claimless delivery has gates.</strong><p>A matched buyer sends the dollars through X Money and appears as the sender. Funded can be identified as @fundedonfloat in the payment notes, not as the sender. Recipient eligibility, marketplace price, and actual USD receipt still require end-to-end verification. Funded has no claim page; blocked payouts remain held as Base USDC and are never labeled complete.</p></div>';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function costList(cost) {
  if (!cost) return '';
  return '<dl><dt>Original units</dt><dd>'+esc(cost.originalQuoteUnits)+'</dd><dt>Creator share</dt><dd>'+esc(cost.creatorUnits)+'</dd><dt>Rounding dust</dt><dd>'+esc(cost.roundingDustUnits)+'</dd><dt>Conversion to USDC</dt><dd>'+esc(cost.convertedUsdc ?? 'pending, no safe route')+'</dd><dt>Bridge fee</dt><dd>'+esc(cost.bridgeFeeUsdc ?? 'not bridged')+'</dd><dt>Marketplace discount</dt><dd>'+(cost.lpDiscountBps == null ? 'not quoted' : esc(cost.lpDiscountBps)+' bps')+'</dd><dt>USD micros delivered</dt><dd>'+esc(cost.deliveredUsdMicros)+'</dd><dt>Still pending</dt><dd>'+esc(cost.pendingUsdc)+'</dd><dt>Payment complete</dt><dd>'+(cost.paymentComplete?'yes':'no')+'</dd></dl>';
}
const empty = (message) => '<div class="card gap"><p class="muted">'+message+'</p></div>';
const split = '<div class="card"><span class="eyebrow">Reference only</span><h2>Float fee distribution</h2><p class="muted">Share of fees after Raydium’s allocation. Only the creator share is intended for Funded.</p><dl><dt>Holder rewards</dt><dd>15%</dd><dt>Creator allocation</dt><dd>5%</dd><dt>Buyback and burn</dt><dd>35%</dd><dt>Trader rewards</dt><dd>35%</dd><dt>Float treasury</dt><dd>10%</dd></dl></div>';
async function request(url, init) {
  const r = await fetch(url,init);
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? 'Request failed');
  return data;
}
function renderOutput(el,value,isError=false) {
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value,null,2);
  el.classList.toggle('err',isError);
}
if (current === '/') {
  html(`<section class="hero">
    <img class="hero-mark" src="/funded-mark.webp" width="72" height="72" alt=""><br><span class="eyebrow">Automatic creator payouts · In development</span><h1>Launch on Float.<br>Get paid in dollars.</h1><p>Funded is building a direct path from genuine Float creator fees to USD in the payout app a creator chooses. No dashboard balance to claim.</p>
    <div class="actions"><a class="btn" href="/launch">Prepare a launch <span aria-hidden="true">→</span></a><a class="btn ghost" href="/explore">Explore the protocol</a></div>
  </section>${notice}<section class="bento gap" aria-label="Funded product preview">
    <div class="card payout-card"><div><span class="eyebrow">Creator payout preview</span><div class="payout-amount">$1,284.20</div><div class="payout-caption"><span class="status-dot" aria-hidden="true"></span>Illustrative only · no live funds</div></div><div class="rail-list"><div class="rail"><span class="rail-icon">X</span><div><strong>X Money</strong><small>Primary acceptance rail</small></div><em>First</em></div><div class="rail"><span class="rail-icon">$</span><div><strong>Cash App</strong><small>Separate creator-approved fallback</small></div><em>Planned</em></div><div class="rail"><span class="rail-icon">V</span><div><strong>Venmo</strong><small>Separate creator-approved fallback</small></div><em>Planned</em></div></div></div>
    <div class="bento-stack"><div class="card path"><span class="eyebrow">Planned payout flow</span><h2>From trading fees to USD</h2><ol><li><span class="num">01</span><div><strong>Launch on Float</strong><small>Keep Float’s native trading mechanics.</small></div></li><li><span class="num">02</span><div><strong>Receive the creator share</strong><small>Attribute the finalized fee receipt.</small></div></li><li><span class="num">03</span><div><strong>Settle into Base USDC</strong><small>Swap and bridge only through verified routes.</small></div></li><li><span class="num">04</span><div><strong>Verify X Money delivery</strong><small>Bind each payment to one order, payee hash, amount, and provider intent window.</small></div></li></ol></div><div class="card"><span class="eyebrow">No claim system</span><h2>Payment is the product.</h2><p>Eligible recipients are paid automatically. If a route is blocked, funds remain held as Base USDC instead of becoming a claimable dashboard balance.</p></div></div>
  </section><section class="grid" aria-label="Funded principles"><div class="card"><h2>Genuine Float tokens</h2><p>No substitute token contract.</p></div><div class="card"><h2>Multi-asset by design</h2><p>Launch support and safe conversion availability remain separate gates.</p></div><div class="card"><h2>Traceable payouts</h2><p>Fees, conversion, bridge settlement, and USD delivery stay independently auditable.</p></div></section>`);
} else if (current === '/launch') {
  html(page('Launch portal','Prepare a Float launch','Save and review a local draft. This is not an unsigned transaction or a token deployment.',notice+`
  <div class="layout gap"><form id="draft" class="card">
  <div class="fields">
  <label>Token name<input name="name" required maxlength="32"></label><label>Ticker<input name="ticker" required maxlength="10" pattern="[A-Za-z0-9]{1,10}"></label>
  <label>Pairing asset<select name="pair"><option value="native:sol">SOL</option><option value="${USDC}">USDC</option><option value="custom">Other Solana mint · draft only</option></select></label>
  <label id="custom" hidden>Pairing mint<input name="customMint" minlength="32" maxlength="44"></label>
  <label>Reference trading fee<select name="feeBps"><option value="100">1%</option><option value="200">2%</option><option value="250">2.5%</option></select></label>
  <label>Preferred payout app<select name="payoutRail"><option value="xmoney">X Money · validation pending</option><option value="cashapp" disabled>Cash App · planned</option><option value="venmo" disabled>Venmo · planned</option></select></label>
  <label>Recipient handle<input name="recipient" placeholder="@handle" required maxlength="31"></label>
  <label>First buy (asset base units)<input name="firstBuyBaseUnits" inputmode="numeric" pattern="[0-9]+" value="0" required></label>
  <label class="full">Solana creator wallet<input name="creatorWallet" minlength="32" maxlength="44" required></label>
  <label>Token image (up to 1 MB)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
  <label>Website<input name="website" type="url" placeholder="https://"></label><label>X profile URL<input name="x" type="url" placeholder="https://x.com/…"></label><label>Telegram<input name="telegram" type="url" placeholder="https://t.me/…"></label>
  <label class="full">Description<textarea name="description" maxlength="1000"></textarea></label>
  <label class="full">Metadata URI<input name="metadataUri" type="url" placeholder="https://"></label>
  <label>Mint nonce<input name="mintNonce" inputmode="numeric" pattern="[0-9]+" value="1"></label>
  <label id="token-program" hidden>Quote token program<select name="quoteTokenProgram"><option value="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">Token</option><option value="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb">Token-2022</option></select></label>
  </div><div class="actions"><button class="btn" type="submit">Save and review draft</button><button class="btn ghost" id="preview" type="button">Review unsigned instruction</button></div><pre id="out" aria-live="polite"></pre></form>
  <div>${split}${sender}<section class="card gap"><span class="eyebrow">Required before live routing</span><h2>Verify the recipient and payout rail</h2><p class="muted">A handle alone is not proof that an account can receive X Money. Production orders remain disabled until the SDK flow is configured and a controlled test verifies eligibility, settlement evidence, live order economics, and actual USD receipt.</p></section><section class="card gap" aria-labelledby="handoff-title"><span class="eyebrow">Official Float handoff</span>
  <h2 id="handoff-title">Continue on Float</h2><p class="muted">Save your draft first. For a Funded intake trial, wait for the operator to assign a dedicated fee wallet. On Float, select <strong>Other wallet</strong> and use that exact address. Draft details aren’t sent to Float and USD payouts aren’t active.</p>
  <div class="actions"><a class="btn ghost" href="https://www.floatlaunch.xyz/create" target="_blank" rel="noopener noreferrer">Open Float’s launch form <span aria-hidden="true">↗</span></a></div></section></div></div>`));
  const form = document.querySelector('#draft'), pair = form.elements.pair, custom = document.querySelector('#custom');
  form.elements.payoutRail.addEventListener('change',()=>{form.elements.recipient.placeholder=form.elements.payoutRail.value==='cashapp'?'$cashtag':'@handle';});
  pair.addEventListener('change',()=>{custom.hidden = pair.value !== 'custom'; form.elements.customMint.required = !custom.hidden; document.querySelector('#token-program').hidden = custom.hidden;});
  form.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const button = form.querySelector('button'), out = document.querySelector('#out');
    button.disabled = true;
    try {
      const v = Object.fromEntries(new FormData(form));
      if (v.pair === 'custom') v.pair = v.customMint;
      v.feeBps = Number(v.feeBps);
      if (v.image.size) {
        if (v.image.size > 1_000_000) throw Error('Choose an image no larger than 1 MB');
        v.imageType = v.image.type;
        const bytes = new Uint8Array(await v.image.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        v.image = btoa(binary);
      } else delete v.image;
      delete v.customMint;
      const result = await request('/api/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});
      renderOutput(out,{draft:result.id,name:v.name,ticker:v.ticker,pair:v.pair,payoutRail:v.payoutRail,referenceFeeBps:v.feeBps,firstBuyBaseUnits:v.firstBuyBaseUnits,status:'Saved locally. No transaction prepared or signed; payee not verified.'});
    } catch(err) { renderOutput(out,err.message,true); }
    finally { button.disabled = false; }
  });
  document.querySelector('#preview').addEventListener('click', async () => {
    const out = document.querySelector('#out'), button = document.querySelector('#preview');
    button.disabled = true;
    try {
      const v = Object.fromEntries(new FormData(form));
      if (v.pair === 'custom') v.pair = v.customMint;
      v.feeBps = Number(v.feeBps);
      delete v.image; delete v.customMint;
      const result = await request('/api/launch-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});
      renderOutput(out,{status:result.status,program:result.program,mint:result.mint,feeReceiver:result.feeReceiver,accounts:result.accounts.length,submit:result.submit,signature:result.signature,firstBuyEncoded:result.firstBuyEncoded,chainPinChecked:result.chainPinChecked});
    } catch (err) { renderOutput(out,err.message,true); }
    finally { button.disabled = false; }
  });
} else if (current === '/how') {
  html(page('Payout architecture','How Funded intends to settle creator fees','Every stage has its own evidence and failure state. A completed swap or bridge is not a completed creator payout.',notice+sender+`
  <section class="lifecycle" aria-label="Planned Funded payout lifecycle">
    <article class="card"><span>01</span><h2>Float receipt</h2><p>Confirm finalized creator-fee movement into the launch’s dedicated receiver and attribute exact integer units.</p><em>Evidence: Solana transaction</em></article>
    <article class="card"><span>02</span><h2>Solana USDC</h2><p>Use an approved route with protected output. Unsupported assets stay in their original form.</p><em>Evidence: finalized swap</em></article>
    <article class="card"><span>03</span><h2>Base USDC</h2><p>Bridge only through a pinned route and reconcile the destination amount before any payout order.</p><em>Evidence: source and destination</em></article>
    <article class="card"><span>04</span><h2>Peer order</h2><p>Create an X Money order only after recipient eligibility, SDK integration, minimums, and live price are known.</p><em>Evidence: accepted order</em></article>
    <article class="card"><span>05</span><h2>USD delivered</h2><p>Mark paid only after each Peer fill matches the persisted deposit, payee hash, amount, provider window, and an unused keyed receipt reference. Raw receipt links stay private.</p><em>Evidence: bound verified fiat fill</em></article>
  </section>
  <section class="grid"><div class="card"><span class="eyebrow">No claim balance</span><h2>Blocked means held</h2><p>If the recipient or route is not eligible, Base USDC stays held. Funded does not silently create a recovery wallet or call the payout complete.</p></div><div class="card"><span class="eyebrow">Honest economics</span><h2>Rate binds at intent</h2><p>Peer Cash reports zero spread against its Base oracle. The buyer’s signal binds the rate; estimates remain approximate until then.</p></div><div class="card"><span class="eyebrow">Visible sender</span><h2>Matched buyer</h2><p>The matched buyer appears as sender. The X Money payment notes can identify Funded as @fundedonfloat.</p></div></section>`));
} else if (current === '/explore') {
  html(page('Read-only tools','Float explorer','Inspect finalized program activity or look up a Solana mint. A program call alone does not prove a Funded launch.',notice+`
  <div class="card gap"><form id="tx" class="entry"><label>Transaction signature<input name="signature" minlength="80" maxlength="88" required></label><button class="btn">Inspect</button></form>
  <button id="recent" class="btn ghost">Load recent Float activity</button><pre id="txout" aria-live="polite"></pre>
  <form id="token" class="entry"><label>Token mint<input name="mint" pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" required></label><button class="btn">Open mint detail</button></form></div>`));
  const out = document.querySelector('#txout');
  async function inspect(query) { renderOutput(out,'Reading…'); try { renderOutput(out,await request('/api/transactions'+query)); } catch(e){renderOutput(out,e.message,true);} }
  document.querySelector('#tx').addEventListener('submit',e=>{e.preventDefault();inspect('?signature='+encodeURIComponent(e.currentTarget.elements.signature.value));});
  document.querySelector('#recent').addEventListener('click',()=>inspect(''));
  document.querySelector('#token').addEventListener('submit',e=>{e.preventDefault();location.href='/token/'+encodeURIComponent(e.currentTarget.elements.mint.value);});
} else if (current.startsWith('/token/')) {
  html(page('Solana mint','Token details','Read finalized mint metadata. This view does not establish Float provenance.',notice+'<pre class="card gap" id="mintout" aria-live="polite">Reading…</pre>'));
  const out = document.querySelector('#mintout');
  request('/api/mint?mint='+encodeURIComponent(current.split('/').at(-1))).then(v=>renderOutput(out,v)).catch(e=>renderOutput(out,e.message,true));
} else if (current === '/earnings') {
  html(page('Creator workspace','Creator earnings','One handle can cover many tokens. Balances appear only after a receipt is attributed. Nothing here is a claim.',notice+sender+`
  <form id="earn" class="card entry"><label>X handle<input name="handle" required maxlength="15"></label><button class="btn">Show earnings</button></form>
  <div id="earnout" class="card gap" aria-live="polite"></div>`));
  document.querySelector('#earn').addEventListener('submit', async event => {
    event.preventDefault();
    const out = document.querySelector('#earnout');
    out.textContent = 'Reading…';
    try {
      const data = await request('/api/earnings?handle='+encodeURIComponent(event.currentTarget.elements.handle.value));
      const rows = data.items.length ? data.items.map(item => '<section><h2>'+esc(item.mint)+'</h2><p>'+esc(item.status)+' · '+esc(item.asset)+' · '+esc(item.units)+'</p>'+costList(item.cost)+'</section>').join('') : '<p class="muted">No attributed earnings for this handle.</p>';
      out.innerHTML = '<p class="muted">'+esc(data.senderNotice)+'</p><p class="muted">'+esc(data.marketplaceNotice)+'</p><p>Marketplace discount '+(data.lpDiscountBps == null ? 'not quoted' : esc(data.lpDiscountBps)+' bps')+'. Payment complete: '+(data.paymentComplete?'yes':'no')+'.</p>'+rows;
    } catch (error) { out.textContent = error.message; }
  });
} else if (current === '/liquidity') {
  html(page('Peer settlement','Liquidity activity','A matched liquidity provider pays the creator through the selected app. A match is not a completed payment.',notice+sender+'<div id="liq" class="card gap" aria-live="polite">Reading…</div>'));
  request('/api/liquidity').then(data => {
    const rows = data.items.length ? data.items.map(item => '<li>'+esc(item.mint)+' · '+esc(item.decision)+' · spread '+esc(item.spreadBps)+' bps · orders '+(item.ordersEnabled?'on':'off')+'</li>').join('') : '<p class="muted">No liquidity-provider activity.</p>';
    document.querySelector('#liq').innerHTML = '<p class="muted">'+esc(data.senderNotice)+'</p><p class="muted">'+esc(data.marketplaceNotice)+'</p><p>Sender display: '+esc(data.senderDisplay)+'. Payment-note identity: '+esc(data.paymentNoteBranding)+'. Marketplace discount: '+(data.marketDiscountBps == null ? 'not quoted' : esc(data.marketDiscountBps)+' bps')+'.</p><ul>'+rows+'</ul>';
  }).catch(error => { document.querySelector('#liq').textContent = error.message; });
} else {
  html(page('Public record','Payout history','Only verified settlement will appear here. Account handles, mailbox data and private recovery information are not public.',notice+'<div id="rows" class="card gap" aria-live="polite">Reading…</div>'));
  request('/api/payouts').then(data=>{
    const rows = data.items.length ? data.items.map(item=>'<section><h2>'+esc(item.status)+'</h2><p>'+esc(item.asset)+' · '+esc(item.units)+'</p>'+costList(item.cost)+'</section>').join('') : '<p class="muted">No verified Funded payouts.</p>';
    document.querySelector('#rows').innerHTML = '<p class="muted">'+esc(data.senderNotice)+'</p><p class="muted">'+esc(data.marketplaceNotice)+'</p><p>Marketplace discount '+(data.lpDiscountBps == null ? 'not quoted' : esc(data.lpDiscountBps)+' bps')+'.</p>'+rows;
  }).catch(e=>{ document.querySelector('#rows').textContent = e.message; });
}
