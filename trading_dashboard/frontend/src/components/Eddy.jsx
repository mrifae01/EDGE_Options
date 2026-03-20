import { useState, useEffect, useRef } from 'react'
import { Send, Sparkles, RotateCcw, ArrowRight } from 'lucide-react'
import './Eddy.css'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt2(v) { return v != null ? parseFloat(v).toFixed(2) : '—' }
function fmt3(v) { return v != null ? parseFloat(v).toFixed(3) : '—' }
function fmtPct(v) { return v != null ? (parseFloat(v) * 100).toFixed(1) + '%' : '—' }
function fmtK(v) {
  if (v == null) return '—'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

// ── Contract card rendered inside Eddy's messages ────────────────────────────
function ContractCard({ contract, onAdd }) {
  var isCall = contract.type === 'call'
  return (
    <div className={'eddy-contract ' + (isCall ? 'eddy-contract-call' : 'eddy-contract-put')}>
      <div className="eddy-contract-top">
        <span className={'eddy-contract-type ' + (isCall ? 'call-label' : 'put-label')}>
          {contract.type?.toUpperCase()}
        </span>
        <span className="eddy-contract-symbol mono">{contract.symbol}</span>
      </div>
      <div className="eddy-contract-grid">
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Strike</div>
          <div className="eddy-cstat-val mono">${fmt2(contract.strike)}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Expiry</div>
          <div className="eddy-cstat-val mono">{contract.expiry || '—'}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">DTE</div>
          <div className="eddy-cstat-val mono">{contract.dte != null ? contract.dte + 'd' : '—'}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Mid</div>
          <div className="eddy-cstat-val mono">${fmt2(contract.mid)}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Delta</div>
          <div className="eddy-cstat-val mono">{fmt3(contract.delta)}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">IV</div>
          <div className="eddy-cstat-val mono">{fmtPct(contract.iv)}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Volume</div>
          <div className="eddy-cstat-val mono">{fmtK(contract.volume)}</div>
        </div>
        <div className="eddy-cstat">
          <div className="eddy-cstat-label">Stock</div>
          <div className="eddy-cstat-val mono">${fmt2(contract.stock_price)}</div>
        </div>
      </div>
      {onAdd && (
        <button className="eddy-add-btn" onClick={function() { onAdd(contract) }}>
          <ArrowRight size={12} /> Add to Plans
        </button>
      )}
    </div>
  )
}

// ── Add to Plans mini-form that appears after clicking a contract ─────────────
function EddyAddForm({ contract, onClose }) {
  var qs = useState(1);    var qty = qs[0];  var setQty  = qs[1]
  var ss = useState('');   var sl  = ss[0];  var setSl   = ss[1]
  var ts = useState('');   var tp  = ts[0];  var setTp   = ts[1]
  var ms = useState(null); var msg = ms[0];  var setMsg  = ms[1]
  var bs = useState(false);var busy= bs[0];  var setBusy = bs[1]

  async function save() {
    if (!sl || parseFloat(sl) <= 0) { setMsg({ err: true, text: 'Stop Loss is required' }); return }
    if (!tp || parseFloat(tp) <= 0) { setMsg({ err: true, text: 'Take Profit is required' }); return }
    setBusy(true)
    try {
      var res      = await fetch('/api/plans')
      var existing = (await res.json()).plans || []
      var plan     = {
        ticker:   contract.underlying,
        contract: contract.symbol,
        qty:      parseInt(qty),
        type:     contract.type === 'put' ? 'SHORT' : 'LONG',
        sl_stock: parseFloat(sl),
        tp_stock: parseFloat(tp),
      }
      var saveRes = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing.concat([plan]))
      })
      if (!saveRes.ok) throw new Error((await saveRes.json()).detail)
      setMsg({ err: false, text: 'Plan saved!' })
    } catch(e) {
      setMsg({ err: true, text: e.message })
    } finally { setBusy(false) }
  }

  return (
    <div className="eddy-add-form">
      <div className="eddy-add-form-title mono">Add to Plans — {contract.symbol}</div>
      <div className="eddy-add-form-fields">
        <div className="eddy-add-field">
          <label>Qty</label>
          <input type="number" min="1" value={qty} onChange={function(e) { setQty(e.target.value) }}/>
        </div>
        <div className="eddy-add-field">
          <label>Stop Loss (stock $)</label>
          <input type="number" step="0.01" placeholder="e.g. 185.00" value={sl} onChange={function(e) { setSl(e.target.value) }}/>
        </div>
        <div className="eddy-add-field">
          <label>Take Profit (stock $)</label>
          <input type="number" step="0.01" placeholder="e.g. 210.00" value={tp} onChange={function(e) { setTp(e.target.value) }}/>
        </div>
        <div className="eddy-add-form-btns">
          <button className="btn btn-blue" onClick={save} disabled={busy} style={{fontSize:12,padding:'6px 14px'}}>
            <ArrowRight size={12}/> Save
          </button>
          <button className="btn btn-ghost" onClick={onClose} style={{fontSize:12,padding:'6px 14px'}}>
            Cancel
          </button>
        </div>
      </div>
      {msg && (
        <div className={'mono eddy-add-msg ' + (msg.err ? 'red' : 'green')}>{msg.text}</div>
      )}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onAddContract }) {
  var isUser = msg.role === 'user'
  var as = useState(null); var addingContract = as[0]; var setAddingContract = as[1]

  return (
    <div className={'eddy-msg ' + (isUser ? 'eddy-msg-user' : 'eddy-msg-eddy')}>
      {!isUser && (
        <div className="eddy-avatar">
          <Sparkles size={12}/>
        </div>
      )}
      <div className={'eddy-bubble ' + (isUser ? 'bubble-user' : 'bubble-eddy')}>
        {/* Text content */}
        {msg.text && (
          <div className="eddy-text" dangerouslySetInnerHTML={{__html: formatText(msg.text)}}/>
        )}

        {/* Contract cards */}
        {msg.contracts && msg.contracts.length > 0 && (
          <div className="eddy-contracts">
            {msg.contracts.map(function(c, i) {
              return (
                <div key={i}>
                  <ContractCard
                    contract={c}
                    onAdd={function(c) { setAddingContract(addingContract === c ? null : c) }}
                  />
                  {addingContract === c && (
                    <EddyAddForm contract={c} onClose={function() { setAddingContract(null) }}/>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Simple markdown-like formatter for Eddy's responses
function formatText(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>')
}

// ── System prompt for Eddy ────────────────────────────────────────────────────
var EDDY_SYSTEM = `You are Eddy, an expert options trading advisor built into a professional trading dashboard.
Your job is to help traders find the best option contracts based on their goals and outlook.

When a user expresses interest in a trade (e.g. "I want to go long on Apple"), you should:
1. Clarify their timeframe if not stated (short-term: 0-2 weeks, medium: 1-3 months, long-term: 3+ months)
2. Clarify their risk appetite if relevant (aggressive: high delta, conservative: lower delta further OTM)
3. Once you have enough info, call the fetch_option_chain tool to get live contracts
4. Analyze the returned contracts and recommend 2-4 specific ones with clear reasoning
5. Explain WHY each contract suits their goal (entry point, risk, reward, Greeks)

You have a direct, confident tone. You are not overly cautious or verbose. You think like a professional trader.
Use markdown formatting: **bold** for key numbers, \`backticks\` for contract symbols.
Keep responses concise and actionable. If you need more info, ask ONE focused question.

Current date: ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`

// ── Main Eddy component ───────────────────────────────────────────────────────
export default function Eddy() {
  var ms  = useState([]);     var messages    = ms[0];  var setMessages    = ms[1]
  var ls  = useState(false);  var loading     = ls[0];  var setLoading     = ls[1]
  var inp = useState('');     var input       = inp[0]; var setInput       = inp[1]
  var err = useState(null);   var error       = err[0]; var setError       = err[1]
  var bottomRef = useRef(null)
  var inputRef  = useRef(null)

  // Scroll to bottom on new messages
  useEffect(function() {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Fetch option chain from our own backend
  async function fetchChain(ticker, expiry, optionType, deltaMin, deltaMax) {
    var body = {
      tickers: [ticker.toUpperCase()],
      limit: 20,
      sort_by: 'volume',
      sort_desc: true,
    }
    if (expiry)    body.expiry_date = expiry
    if (optionType) body.option_type = optionType
    if (deltaMin)  body.delta_min = parseFloat(deltaMin)
    if (deltaMax)  body.delta_max = parseFloat(deltaMax)

    var res  = await fetch('/api/screener/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    var data = await res.json()
    return data.results || []
  }

  // Build Anthropic API messages from our conversation history
  function buildAPIMessages(history) {
    return history.map(function(m) {
      return { role: m.role, content: m.text || '' }
    })
  }

  async function send() {
    var text = input.trim()
    if (!text || loading) return
    setInput('')
    setError(null)

    var userMsg = { role: 'user', text: text }
    var newHistory = messages.concat([userMsg])
    setMessages(newHistory)
    setLoading(true)

    try {
      // Call Anthropic API with tool use for option chain fetching
      var response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: EDDY_SYSTEM,
          tools: [{
            name: 'fetch_option_chain',
            description: 'Fetch live option contracts for a ticker from Alpaca. Use this when the user wants to trade a specific stock.',
            input_schema: {
              type: 'object',
              properties: {
                ticker:      { type: 'string',  description: 'Stock ticker symbol e.g. AAPL' },
                option_type: { type: 'string',  description: 'call or put', enum: ['call', 'put'] },
                expiry:      { type: 'string',  description: 'Expiry date YYYY-MM-DD (optional, leave blank for nearest Friday)' },
                delta_min:   { type: 'number',  description: 'Minimum absolute delta (e.g. 0.3)' },
                delta_max:   { type: 'number',  description: 'Maximum absolute delta (e.g. 0.7)' },
              },
              required: ['ticker', 'option_type'],
            }
          }],
          messages: buildAPIMessages(newHistory),
        })
      })

      var data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'API error')
      }

      // Check if model wants to use the tool
      var toolUseBlock = data.content.find(function(b) { return b.type === 'tool_use' })
      var textBlock    = data.content.find(function(b) { return b.type === 'text' })

      if (toolUseBlock) {
        // Show a "looking up contracts" interim message
        var thinkingMsg = {
          role: 'assistant',
          text: textBlock ? textBlock.text : 'Let me pull up the live option chain for that…',
          contracts: [],
          _interim: true,
        }
        setMessages(newHistory.concat([thinkingMsg]))

        // Execute the tool
        var toolInput    = toolUseBlock.input
        var chainResults = await fetchChain(
          toolInput.ticker,
          toolInput.expiry || '',
          toolInput.option_type,
          toolInput.delta_min,
          toolInput.delta_max
        )

        // Send tool result back to Claude
        var toolResultMessages = buildAPIMessages(newHistory).concat([
          { role: 'assistant', content: data.content },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: JSON.stringify(chainResults.slice(0, 15)), // top 15 contracts
            }]
          }
        ])

        var response2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: EDDY_SYSTEM,
            tools: [{
              name: 'fetch_option_chain',
              description: 'Fetch live option contracts for a ticker from Alpaca.',
              input_schema: {
                type: 'object',
                properties: {
                  ticker:      { type: 'string'  },
                  option_type: { type: 'string', enum: ['call', 'put'] },
                  expiry:      { type: 'string'  },
                  delta_min:   { type: 'number'  },
                  delta_max:   { type: 'number'  },
                },
                required: ['ticker', 'option_type'],
              }
            }],
            messages: toolResultMessages,
          })
        })

        var data2 = await response2.json()
        if (!response2.ok) throw new Error(data2.error?.message || 'API error')

        var finalText  = data2.content.filter(function(b){ return b.type === 'text' }).map(function(b){ return b.text }).join('\n')

        // Parse out which contract symbols Eddy mentions so we can attach their data
        var mentionedSymbols = []
        chainResults.forEach(function(c) {
          if (c.symbol && finalText.includes(c.symbol)) mentionedSymbols.push(c)
        })
        // If no symbols explicitly mentioned, show top 3 by volume
        var displayContracts = mentionedSymbols.length > 0
          ? mentionedSymbols.slice(0, 4)
          : chainResults.slice(0, 3)

        var eddyMsg = {
          role: 'assistant',
          text: finalText,
          contracts: displayContracts,
        }
        setMessages(newHistory.concat([eddyMsg]))

      } else {
        // Pure text response (clarifying questions, no tool call)
        var finalTextOnly = data.content.filter(function(b){ return b.type === 'text' }).map(function(b){ return b.text }).join('\n')
        setMessages(newHistory.concat([{ role: 'assistant', text: finalTextOnly, contracts: [] }]))
      }

    } catch(e) {
      setError(e.message)
      setMessages(newHistory.concat([{
        role: 'assistant',
        text: 'Sorry, I ran into an error. Please try again.',
        contracts: [],
      }]))
    } finally {
      setLoading(false)
      setTimeout(function() { if (inputRef.current) inputRef.current.focus() }, 50)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function reset() {
    setMessages([])
    setInput('')
    setError(null)
  }

  var isEmpty = messages.length === 0

  return (
    <div className="eddy-root">

      {/* Empty state */}
      {isEmpty && (
        <div className="eddy-empty">
          <div className="eddy-empty-icon">
            <Sparkles size={28}/>
          </div>
          <div className="eddy-empty-title">Ask Eddy</div>
          <div className="eddy-empty-sub mono dim">
            Your options trading advisor. Tell me what you want to trade.
          </div>
          <div className="eddy-starters">
            {[
              'I want to go LONG on Apple this week',
              'Find me aggressive NVDA calls for earnings',
              'I\'m bearish on SPY, short term puts',
              'Show me low-risk TSLA calls for next month',
            ].map(function(s) {
              return (
                <button key={s} className="eddy-starter" onClick={function() { setInput(s) }}>
                  {s}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Messages */}
      {!isEmpty && (
        <div className="eddy-messages">
          {messages.filter(function(m) { return !m._interim }).map(function(msg, i) {
            return <MessageBubble key={i} msg={msg}/>
          })}

          {loading && (
            <div className="eddy-msg eddy-msg-eddy">
              <div className="eddy-avatar"><Sparkles size={12}/></div>
              <div className="eddy-bubble bubble-eddy eddy-typing">
                <span/><span/><span/>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>
      )}

      {/* Input bar */}
      <div className="eddy-input-bar">
        {!isEmpty && (
          <button className="eddy-reset-btn" onClick={reset} title="New conversation">
            <RotateCcw size={14}/>
          </button>
        )}
        <div className="eddy-input-wrap">
          <textarea
            ref={inputRef}
            className="eddy-input"
            rows={1}
            placeholder="e.g. I want to go long on Apple this week…"
            value={input}
            onChange={function(e) { setInput(e.target.value) }}
            onKeyDown={handleKey}
          />
        </div>
        <button className="eddy-send-btn" onClick={send} disabled={loading || !input.trim()}>
          <Send size={15}/>
        </button>
      </div>

      {error && (
        <div className="mono red" style={{fontSize:11,textAlign:'center',padding:'6px 0'}}>{error}</div>
      )}
    </div>
  )
}