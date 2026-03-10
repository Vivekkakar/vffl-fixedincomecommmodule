import { useState, useRef, useCallback } from "react";

const SAMPLE_CSV = `client_id,client_name,family_group,bond_name,isin,num_bonds,face_value_invested,date_of_investment,yield_pct,coupon_rate,purchase_date,issue_date,maturity_date,interest_frequency,credit_rating,rating_agency,cf_date_1,cf_amount_1,cf_date_2,cf_amount_2,cf_date_3,cf_amount_3,cf_date_4,cf_amount_4,cf_date_5,cf_amount_5
C001,Ramesh Sharma,Sharma Family,9.30% KIIFB 2030,INE046A08330,50,5000000,2023-06-15,9.30,9.30,2023-06-15,2020-06-15,2030-06-15,Half-Yearly,AAA,CRISIL,2026-06-15,232500,2026-12-15,232500,2027-06-15,232500,2027-12-15,232500,2030-06-15,5232500
C002,Sunita Sharma,Sharma Family,8.75% NHAI Bond 2028,INE202E07106,20,2000000,2022-03-20,8.75,8.75,2022-03-20,2018-03-20,2028-03-20,Annual,AAA,ICRA,2026-03-20,87500,2027-03-20,87500,2028-03-20,2087500,,,
C003,Priya Mehta,,7.50% HDFC Ltd 2027,INE001A07PN7,30,3000000,2024-08-10,7.50,7.50,2024-08-10,2022-08-10,2027-08-10,Quarterly,AA+,CRISIL,2026-05-10,56250,2026-08-10,56250,2026-11-10,56250,2027-02-10,56250,2027-08-10,3056250`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = []; let cur = "", inQ = false;
    for (let c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || "");
    return obj;
  });
}

function groupByFamily(rows) {
  const families = {}, individuals = {};
  rows.forEach(r => {
    const fam = r.family_group ? r.family_group.trim() : "";
    if (fam) { if (!families[fam]) families[fam] = []; families[fam].push(r); }
    else { const k = r.client_name || r.client_id || "Unknown"; if (!individuals[k]) individuals[k] = []; individuals[k].push(r); }
  });
  return { families, individuals };
}

function weightedAvgYield(bonds) {
  let sw = 0, sv = 0;
  bonds.forEach(b => { const f = parseFloat(b.face_value_invested)||0, y = parseFloat(b.yield_pct)||0; sw += f*y; sv += f; });
  return sv > 0 ? (sw/sv).toFixed(2) : "0.00";
}

function cashflowIn(bonds, days) {
  const now = new Date(), future = new Date(now.getTime() + days*86400000);
  let t = 0;
  bonds.forEach(b => { for (let i=1;i<=24;i++) { const d=b[`cf_date_${i}`],a=b[`cf_amount_${i}`]; if(!d||!a) continue; const dt=new Date(d); if(dt>=now&&dt<=future) t+=parseFloat(a)||0; } });
  return t;
}

function allCashflows(bonds) {
  const now = new Date(); now.setHours(0,0,0,0);
  const map = {};
  bonds.forEach(b => { for (let i=1;i<=24;i++) { const d=b[`cf_date_${i}`],a=b[`cf_amount_${i}`]; if(!d||!a||new Date(d)<now) continue; map[d]=(map[d]||0)+(parseFloat(a)||0); } });
  return Object.entries(map).sort((a,b)=>new Date(a[0])-new Date(b[0]));
}

function fmtINR(n) {
  if (n===null||n===undefined||isNaN(n)) return "—";
  return (n<0?"-Rs.":"Rs.") + new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(Math.abs(n));
}

function fmtINRui(n) {
  if (n===null||n===undefined||isNaN(n)) return "—";
  return (n<0?"-\u20B9":"\u20B9") + new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(Math.abs(n));
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}

// ── Download HTML report file ─────────────────────────────────────────────────
function downloadReport(html, filename) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── AI Commentary ─────────────────────────────────────────────────────────────
async function generateCommentary(bonds, wavg, hdfcRate) {
  const bondList = bonds.map(b=>`${b.bond_name} (${b.yield_pct}% yield, matures ${b.maturity_date})`).join("; ");
  const today = new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});
  const prompt = `You are a senior fixed income analyst at Vivek Financial Focus Limited. Today is ${today}. Write a concise professional market commentary (3 short paragraphs, plain text only, no bullet points, no markdown, no headings) for a client bond portfolio report.\n\nPara 1: Current Indian interest rate environment, RBI policy stance, repo rate direction, inflation trajectory. Briefly mention global factors if relevant.\nPara 2: How this rate scenario impacts the client portfolio (weighted avg yield: ${wavg}%, bonds: ${bondList}).\nPara 3: Forward-looking 90-day view on holding strategy and reinvestment. No explicit forecasts.\n\nRules: Authoritative, calm, client-friendly. Do NOT invent specific dates or events. Under 220 words. Plain prose only. NO markdown, NO bold, NO headers, NO bullet points whatsoever.`;
  const resp = await fetch("/api/anthropic", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] })
  });
  const data = await resp.json();
  return data.content?.[0]?.text || "Market commentary unavailable.";
}

// ── PDF HTML Builder ──────────────────────────────────────────────────────────
function buildPDFHtml(entityName, bonds, commentary, wavg, hdfcRate, poRate, logoDataUrl) {
  const totalInvested = bonds.reduce((s,b)=>s+(parseFloat(b.face_value_invested)||0),0);
  const extraHDFC = totalInvested*(parseFloat(wavg)-parseFloat(hdfcRate))/100;
  const extraPO = totalInvested*(parseFloat(wavg)-parseFloat(poRate))/100;
  const cf30=cashflowIn(bonds,30), cf60=cashflowIn(bonds,60), cf90=cashflowIn(bonds,90);
  const cfs = allCashflows(bonds);
  let cumulative = 0;
  const reportDate = new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});

  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" style="height:40px;width:auto;object-fit:contain;" />`
    : `<div style="width:44px;height:40px;background:#C45717;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;">VF</div>`;

  const bondRows = bonds.map((b,i)=>`
    <tr style="background:${i%2===0?'#fffcf8':'#faf6f0'}">
      <td>${(b.bond_name||'').substring(0,28)}</td>
      <td>${b.isin||'—'}</td>
      <td>${fmtINR(parseFloat(b.face_value_invested)||0)}</td>
      <td>${b.date_of_investment ? fmtDate(b.date_of_investment) : '—'}</td>
      <td>${b.coupon_rate||'—'}%</td>
      <td>${b.yield_pct||'—'}%</td>
      <td>${fmtDate(b.maturity_date)}</td>
      <td>${b.interest_frequency||'—'}</td>
    </tr>
    <tr style="background:${i%2===0?'#f7f3ee':'#f2ede6'};font-size:9px;color:#7a5a3a;">
      <td>Purchased: ${fmtDate(b.purchase_date)}</td>
      <td colspan="2">Issued: ${fmtDate(b.issue_date)}</td>
      <td colspan="2">Rating: <strong>${b.credit_rating||'—'}</strong> (${b.rating_agency||'—'})</td>
      <td colspan="2">Units: ${b.num_bonds||'—'}</td>
    </tr>`).join('');

  const cfRows = cfs.map(([date,amt],i)=>{ cumulative+=amt; return `<tr style="background:${i%2===0?'#fffcf8':'#faf6f0'}"><td>${fmtDate(date)}</td><td>${fmtINR(amt)}</td><td>${fmtINR(cumulative)}</td></tr>`; }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size:10px; color:#2a1a0a; background:#fff; padding:14mm 16mm; max-width:178mm; margin:0 auto; }
  @page { size:A4; margin:14mm 16mm; }
  @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; padding:0; max-width:none; } .no-break { page-break-inside:avoid; } }
  .header { background:#faf6f0; border-top:4px solid #C45717; padding:12px 0 10px; margin-bottom:12px; display:flex; align-items:center; gap:14px; }
  .firm-name { font-size:13px; font-weight:700; color:#C45717; letter-spacing:0.5px; }
  .firm-sub { font-size:8px; color:#a07050; margin-top:2px; }
  .report-title { font-size:20px; font-weight:300; color:#2a1a0a; margin-bottom:2px; }
  .report-title strong { color:#C45717; font-weight:700; }
  .entity-name { font-size:12px; color:#7a5030; font-style:italic; margin-bottom:2px; }
  .report-date { font-size:9px; color:#a07050; }
  .divider { border:none; border-top:1px solid #ddd; margin:10px 0; }
  .section-title { font-size:10px; font-weight:700; color:#8a3c0a; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; border-bottom:1.5px solid #C45717; padding-bottom:3px; }
  .commentary { font-size:9.5px; line-height:1.65; color:#3a2a1a; background:#fffdf8; border-left:3px solid #C45717; padding:8px 10px; margin-bottom:10px; }
  .boxes-row { display:flex; gap:8px; margin-bottom:10px; }
  .box { flex:1; border-radius:6px; padding:10px; text-align:center; }
  .box-val { font-size:14px; font-weight:700; margin-bottom:3px; }
  .box-label { font-size:8px; color:#a07050; }
  .box-plain { background:#faf6f0; }
  .box-plain .box-val { color:#2a1a0a; }
  .box-accent { background:#C45717; }
  .box-accent .box-val { color:#fff; font-size:16px; }
  .box-accent .box-label { color:#f0d8c0; }
  .fd-row { display:flex; gap:8px; margin-bottom:10px; }
  .fd-box { flex:1; border:1.5px solid #4a9a4a; border-radius:6px; background:#f0f8f0; padding:10px; text-align:center; }
  .fd-title { font-size:8px; font-weight:700; color:#3a7a3a; margin-bottom:4px; }
  .fd-rates { font-size:11px; font-weight:700; color:#1a6a1a; margin-bottom:4px; }
  .fd-extra { font-size:9px; color:#2a7a2a; font-weight:600; letter-spacing:0.3px; }
  .strip { display:flex; background:#f8f4eb; border-radius:6px; margin-bottom:10px; }
  .strip-cell { flex:1; text-align:center; padding:8px; }
  .strip-cell + .strip-cell { border-left:1px solid #d8c8a8; }
  .strip-label { font-size:8px; font-weight:700; color:#8a6840; margin-bottom:3px; }
  .strip-val { font-size:12px; font-weight:700; color:#C45717; }
  table { width:100%; border-collapse:collapse; margin-bottom:10px; font-size:9px; }
  th { background:#f5e8d0; color:#7a3a0a; font-weight:700; padding:4px 5px; text-align:left; font-size:8.5px; }
  td { padding:3px 5px; vertical-align:top; }
  .footer { margin-top:16px; border-top:1px solid #ddd; padding-top:6px; font-size:8px; color:#a07050; font-style:italic; text-align:center; }
</style>
</head><body>
<div class="header">
  <div>${logoHtml}</div>
  <div>
    <div class="firm-name">VIVEK FINANCIAL FOCUS LIMITED</div>
    <div class="firm-sub">NSE &amp; BSE Member Broker &nbsp;|&nbsp; NSDL Depository Participant &nbsp;|&nbsp; SEBI Registered</div>
  </div>
  <div style="margin-left:auto;text-align:right;">
    <div style="font-size:8px;color:#b09070;letter-spacing:1px;">FIXED INCOME</div>
    <div style="font-size:11px;font-weight:700;color:#C45717;">PORTFOLIO STATEMENT</div>
  </div>
</div>

<div class="report-title">Fixed Income <strong>Portfolio Statement</strong></div>
<div class="entity-name">${entityName}</div>
<div class="report-date">Report Date: ${reportDate}</div>
<hr class="divider" />

<div class="no-break">
<div class="section-title">Market Commentary</div>
<div class="commentary">${commentary
  .replace(/\*\*[^*]+\*\*/g, m => m.slice(2,-2))
  .replace(/^#+\s+.+$/gm, '')
  .replace(/\n\n/g,'</div><div class="commentary" style="margin-top:6px;">')
  .replace(/\n/g,' ')
  .trim()
}</div>
</div>

<div class="no-break">
<div class="boxes-row">
  <div class="box box-plain"><div class="box-val">${fmtINR(totalInvested)}</div><div class="box-label">Total Invested</div></div>
  <div class="box box-accent"><div class="box-val">${wavg}%</div><div class="box-label">Portfolio Wtd Yield</div></div>
  <div class="box box-plain"><div class="box-val">${bonds.length}</div><div class="box-label">No. of Bonds</div></div>
</div>
</div>

<div class="no-break">
<div class="fd-row">
  <div class="fd-box">
    <div class="fd-title">vs HDFC Bank FD (1Y)</div>
    <div class="fd-rates">${wavg}% vs ${hdfcRate}%</div>
    <div class="fd-extra">${extraHDFC>=0?'Extra income: '+fmtINR(Math.abs(extraHDFC))+' p.a.':'Below FD by: '+fmtINR(Math.abs(extraHDFC))+' p.a.'}</div>
  </div>
  <div class="fd-box">
    <div class="fd-title">vs Post Office TD (1Y)</div>
    <div class="fd-rates">${wavg}% vs ${poRate}%</div>
    <div class="fd-extra">${extraPO>=0?'Extra income: '+fmtINR(Math.abs(extraPO))+' p.a.':'Below FD by: '+fmtINR(Math.abs(extraPO))+' p.a.'}</div>
  </div>
</div>
</div>

<div class="no-break">
<div class="strip">
  <div class="strip-cell"><div class="strip-label">Next 30 Days</div><div class="strip-val">${fmtINR(cf30)}</div></div>
  <div class="strip-cell"><div class="strip-label">Next 60 Days</div><div class="strip-val">${fmtINR(cf60)}</div></div>
  <div class="strip-cell"><div class="strip-label">Next 90 Days</div><div class="strip-val">${fmtINR(cf90)}</div></div>
</div>
</div>

<div class="no-break">
<div class="section-title">Bond Holdings</div>
<table>
  <thead><tr><th>Bond Name</th><th>ISIN</th><th>Invested</th><th>Date of Investment</th><th>Coupon</th><th>Yield</th><th>Maturity</th><th>Frequency</th></tr></thead>
  <tbody>${bondRows}</tbody>
</table>
</div>

<div class="no-break">
<div class="section-title">Cashflow Schedule to Maturity</div>
<table>
  <thead><tr><th>Date</th><th>Amount</th><th>Cumulative</th></tr></thead>
  <tbody>${cfRows}</tbody>
</table>
</div>

<div class="footer">LightPillar — Powered by Vivek Financial Focus Limited &nbsp;|&nbsp; SEBI Reg. No. INZ000XXXXXX &nbsp;|&nbsp; This report is for information purposes only and does not constitute investment advice.</div>
<script>window.addEventListener("load", () => setTimeout(() => window.print(), 500));</script>
</body></html>`;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [csvData, setCsvData] = useState(null);

  const [parsed, setParsed] = useState(null);
  const [groups, setGroups] = useState(null);
  const [hdfcRate, setHdfcRate] = useState("6.60");
  const [poRate, setPoRate] = useState("6.90");
  const [selected, setSelected] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState(false);
  const [fetchingRates, setFetchingRates] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [csvCopied, setCsvCopied] = useState(false);
  const fileRef = useRef();
  const logoRef = useRef();

  const handleFile = useCallback(e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      setCsvData(text);
      const rows = parseCSV(text);
      setParsed(rows);
      const g = groupByFamily(rows);
      setGroups(g);
      setSelected([...Object.keys(g.families),...Object.keys(g.individuals)]);
      setDone(false);
    };
    reader.readAsText(f);
  }, []);

  const handleLogo = useCallback(e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setLogoDataUrl(ev.target.result);
    reader.readAsDataURL(f);
  }, []);

  const fetchRates = async () => {
    setFetchingRates(true);
    try {
      const resp = await fetch("/api/anthropic", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:300,
          tools:[{type:"web_search_20250305",name:"web_search"}],
          messages:[{role:"user",content:'Current HDFC Bank 1yr FD rate and Post Office TD 1yr rate. Reply ONLY with JSON: {"hdfc":"6.60","po":"6.90"}'}] })
      });
      const data = await resp.json();
      const t = data.content?.find(c=>c.type==="text");
      if (t) { const m=t.text.match(/\{[^}]+\}/); if(m){const r=JSON.parse(m[0]); if(r.hdfc)setHdfcRate(r.hdfc); if(r.po)setPoRate(r.po);} }
    } catch(e) { console.error(e); }
    setFetchingRates(false);
  };

  const allEntities = groups ? [
    ...Object.entries(groups.families).map(([k,bonds])=>({key:k,label:k+" (Family)",bonds})),
    ...Object.entries(groups.individuals).map(([k,bonds])=>({key:k,label:k,bonds}))
  ] : [];

  const toggleSelect = key => setSelected(prev => prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);

  const generateAll = async () => {
    if (!groups||selected.length===0) return;
    setGenerating(true); setDone(false);
    const toGen = allEntities.filter(e=>selected.includes(e.key));
    const dateStr = new Date().toISOString().slice(0,10);
    try {
      setProgress("Generating market commentary…");
      const allBonds = toGen.flatMap(e=>e.bonds);
      const commentary = await generateCommentary(allBonds, weightedAvgYield(allBonds), hdfcRate);

      setProgress(`Building ${toGen.length} report${toGen.length>1?"s":""}…`);
      // Build all reports first
      const reports = toGen.map(e => ({
        html: buildPDFHtml(e.label, e.bonds, commentary, weightedAvgYield(e.bonds), hdfcRate, poRate, logoDataUrl),
        filename: `VFFL_${e.label.replace(/\s+/g,"_")}_${dateStr}`
      }));
      // Download one at a time with generous gap so browser doesn't block
      for (let i = 0; i < reports.length; i++) {
        setProgress(`Downloading report ${i+1} of ${reports.length}…`);
        downloadReport(reports[i].html, reports[i].filename);
        if (i < reports.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
      setProgress(""); setDone(true);
    } catch(err) {
      setProgress("Error: "+(err.message||"Something went wrong"));
    }
    setGenerating(false);
  };

  const copyTemplate = () => {
    navigator.clipboard.writeText(SAMPLE_CSV)
      .then(()=>{setCsvCopied(true);setTimeout(()=>setCsvCopied(false),2500);})
      .catch(()=>{});
  };

  const c = "#C45717";
  const card = { background:"#fff", border:"1px solid #E2D0BA", borderRadius:10, padding:"22px 26px", marginBottom:14, boxShadow:"0 1px 4px rgba(0,0,0,0.04)" };
  const btn = (outline) => ({ background:outline?"transparent":c, border:`1.5px solid ${c}`, color:outline?c:"#fff", padding:"7px 18px", borderRadius:6, fontSize:12, cursor:"pointer" });

  return (
    <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      {/* Header */}
      <div style={{background:"#fff",borderBottom:`2px solid ${c}`,padding:"0 36px",boxShadow:"0 1px 6px rgba(0,0,0,0.06)"}}>
        <div style={{maxWidth:940,margin:"0 auto",padding:"13px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:40,height:40,borderRadius:7,background:"#faf6f0",border:"1px solid #e8d5bb",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",cursor:"pointer"}}
              onClick={()=>logoRef.current?.click()} title="Click to upload logo">
              {logoDataUrl
                ? <img src={logoDataUrl} style={{width:32,height:32,objectFit:"contain"}} alt="Logo"/>
                : <span style={{fontSize:8,color:c,fontWeight:"bold",textAlign:"center",lineHeight:1.2}}>VF<br/><span style={{fontSize:6.5,color:"#a07050"}}>logo</span></span>}
              <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} style={{display:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"#2a1a0a",letterSpacing:0.6}}>Vivek Financial Focus Limited</div>
              <div style={{fontSize:10,color:"#a07050",marginTop:1}}>NSE &amp; BSE Member · NSDL DP · SEBI Registered</div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:"#b09070",letterSpacing:1.5,textTransform:"uppercase"}}>Fixed Income</div>
            <div style={{fontSize:12,color:c,fontWeight:600,letterSpacing:0.8}}>Report Generator</div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:940,margin:"0 auto",padding:"28px 36px 60px"}}>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:10,color:c,letterSpacing:2.5,textTransform:"uppercase",marginBottom:5}}>Client Portfolio Reports</div>
          <h1 style={{margin:0,fontSize:24,fontWeight:300,color:"#2a1a0a",lineHeight:1.3}}>
            Generate Fixed Income <span style={{color:c,fontWeight:600}}>Portfolio Statements</span>
          </h1>

        </div>

        {/* Step 1 */}
        <div style={card}>
          <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:c,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:"bold",flexShrink:0}}>1</div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>Upload Portfolio Data</div>
              <div style={{fontSize:10,color:"#a07050",marginTop:1}}>CSV with client bonds and cashflow schedules</div>
            </div>
          </div>
          <p style={{fontSize:11,color:"#7a5a3a",margin:"0 0 12px",lineHeight:1.7}}>
            Clients sharing the same <code style={{background:"#f5ede0",color:c,padding:"1px 5px",borderRadius:3,fontSize:10}}>family_group</code> are consolidated into one report.
          </p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <button style={btn(true)} onClick={()=>setShowTemplate(t=>!t)}>{showTemplate?"▲ Hide Template":"↓ CSV Template"}</button>
            <button style={btn(false)} onClick={()=>fileRef.current?.click()}>↑ Upload CSV</button>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{display:"none"}}/>
            {csvData && <span style={{fontSize:11,color:"#4a8a4a"}}>✓ {parsed?.length} bond rows loaded</span>}
          </div>
          {showTemplate && (
            <div style={{marginTop:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <span style={{fontSize:10,color:"#9a7050"}}>Copy → paste into text editor → save as <strong>.csv</strong></span>
                <button onClick={copyTemplate} style={{...btn(false),padding:"3px 12px",fontSize:10,background:csvCopied?"#4a8a4a":c}}>{csvCopied?"✓ Copied!":"Copy"}</button>
              </div>
              <textarea readOnly value={SAMPLE_CSV} style={{width:"100%",height:80,fontSize:9.5,fontFamily:"monospace",background:"#fdf8f2",border:"1px solid #dfd0ba",borderRadius:5,padding:7,color:"#5a3a1a",resize:"vertical",boxSizing:"border-box",outline:"none"}}/>
              <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1px 18px",fontSize:10,color:"#9a7050",lineHeight:1.9}}>
                {[["client_id","Unique client ID"],["client_name","Full name"],["family_group","Shared = one consolidated PDF"],["bond_name","Bond description"],["isin","ISIN code"],["num_bonds","Units held"],["face_value_invested","Total face value"],["date_of_investment","Date funds were invested (YYYY-MM-DD)"],["yield_pct","Yield to maturity"],["coupon_rate","Coupon rate"],["purchase_date","YYYY-MM-DD"],["issue_date","YYYY-MM-DD"],["maturity_date","YYYY-MM-DD"],["interest_frequency","Monthly/Quarterly/Half-Yearly/Annual"],["credit_rating","AAA / AA+ / AA"],["rating_agency","CRISIL / ICRA / CARE"],["cf_date_1…24","Future cashflow dates"],["cf_amount_1…24","Cashflow amounts"]].map(([col,desc])=>(
                  <div key={col}><code style={{background:"#f0e4d0",color:c,padding:"0 3px",borderRadius:2,fontSize:9.5}}>{col}</code> — {desc}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div style={card}>
          <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:c,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:"bold",flexShrink:0}}>2</div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>FD Benchmark Rates</div>
              <div style={{fontSize:10,color:"#a07050",marginTop:1}}>Used to calculate extra income vs fixed deposits</div>
            </div>
          </div>
          <div style={{display:"flex",gap:20,alignItems:"flex-end",flexWrap:"wrap"}}>
            {[["HDFC Bank 1Y FD (%)",hdfcRate,setHdfcRate],["Post Office TD 1Y (%)",poRate,setPoRate]].map(([label,val,set])=>(
              <div key={label}>
                <label style={{fontSize:9.5,color:"#9a7050",display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:0.4}}>{label}</label>
                <input type="text" value={val} onChange={e=>set(e.target.value)}
                  style={{background:"#fdf8f2",border:"1px solid #dfd0ba",borderRadius:6,padding:"7px 11px",fontSize:15,width:84,color:"#2a1a0a",outline:"none"}}/>
              </div>
            ))}
            <button onClick={fetchRates} disabled={fetchingRates} style={{...btn(true),opacity:fetchingRates?0.5:1,cursor:fetchingRates?"not-allowed":"pointer"}}>
              {fetchingRates?"Fetching…":"⟳ Fetch Live Rates"}
            </button>
          </div>
        </div>

        {/* Step 3 */}
        {allEntities.length > 0 && (
          <div style={card}>
            <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:c,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:"bold",flexShrink:0}}>3</div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>Select &amp; Generate</div>
                <div style={{fontSize:10,color:"#a07050",marginTop:1}}>{allEntities.length} client{allEntities.length!==1?"s":""} detected</div>
              </div>
            </div>
            <div style={{display:"flex",gap:7,marginBottom:11}}>
              <button onClick={()=>setSelected(allEntities.map(e=>e.key))} style={{fontSize:9.5,padding:"2px 11px",border:`1px solid ${c}`,borderRadius:20,background:"transparent",color:c,cursor:"pointer"}}>Select All</button>
              <button onClick={()=>setSelected([])} style={{fontSize:9.5,padding:"2px 11px",border:"1px solid #c0a080",borderRadius:20,background:"transparent",color:"#9a7050",cursor:"pointer"}}>Clear</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8,marginBottom:18}}>
              {allEntities.map(e=>{
                const sel = selected.includes(e.key);
                return (
                  <div key={e.key} onClick={()=>toggleSelect(e.key)}
                    style={{border:`1.5px solid ${sel?c:"#e0cdb5"}`,borderRadius:7,padding:"9px 13px",cursor:"pointer",background:sel?"#fff4ec":"#fdfaf6"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:13,height:13,borderRadius:3,background:sel?c:"transparent",border:`1.5px solid ${sel?c:"#c0a080"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {sel&&<span style={{color:"#fff",fontSize:8,lineHeight:1}}>✓</span>}
                      </div>
                      <div>
                        <div style={{fontSize:11,fontWeight:600,color:"#2a1a0a"}}>{e.label}</div>
                        <div style={{fontSize:9.5,color:"#a07050",marginTop:1}}>{e.bonds.length} bond{e.bonds.length!==1?"s":""} · Yield: {weightedAvgYield(e.bonds)}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <button onClick={generateAll} disabled={generating||selected.length===0}
                style={{...btn(false),padding:"10px 28px",fontSize:13,opacity:generating||selected.length===0?0.5:1,cursor:generating||selected.length===0?"not-allowed":"pointer"}}>
                {generating?"Generating…":`Generate ${selected.length} Report${selected.length!==1?"s":""}`}
              </button>
              {progress && <span style={{fontSize:11,color:"#a07050",fontStyle:"italic"}}>{progress}</span>}
              {done && <span style={{fontSize:11,color:"#4a8a4a",fontWeight:600}}>✓ Downloaded! Open the .html file → Ctrl+P → Save as PDF</span>}
            </div>
          </div>
        )}

        {!csvData && (
          <div style={{textAlign:"center",padding:"36px 0",color:"#c0a880",fontSize:13}}>Upload a CSV file to get started</div>
        )}
      </div>
    </div>
  );
}
