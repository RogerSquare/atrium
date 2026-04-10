import { useState, useEffect, useRef } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { API_BASE, apiFetch } from '../config'

export default function GifPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const searchTimeout = useRef(null)

  const fetchGifs = async (q) => {
    setLoading(true)
    setError(null)
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : ''
      const res = await apiFetch(`${API_BASE}/api/chat/gifs${params}`)
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to load GIFs')
        setGifs([])
      } else {
        const data = await res.json()
        setGifs(data)
      }
    } catch (err) {
      setError('Failed to connect')
      setGifs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGifs('')
  }, [])

  const handleSearch = (value) => {
    setQuery(value)
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchGifs(value), 400)
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-app-bg border border-app-border rounded-xl shadow-2xl overflow-hidden z-20" style={{ backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border">
        <Search className="w-3.5 h-3.5 text-app-text-muted shrink-0" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search GIFs..."
          className="flex-1 bg-transparent text-xs text-app-text placeholder:text-app-text-muted focus:outline-none"
        />
        <button onClick={onClose} className="p-1 text-app-text-muted hover:text-app-text rounded transition-colors">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Grid */}
      <div className="h-[200px] overflow-y-auto custom-scrollbar p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-app-text-muted animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-[11px] text-app-text-muted/50 italic px-4 text-center">
            {error}
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px] text-app-text-muted/50 italic">
            No GIFs found
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {gifs.map(gif => (
              <button
                key={gif.id}
                onClick={() => { onSelect(gif.full || gif.tiny); onClose() }}
                className="rounded-lg overflow-hidden hover:ring-2 hover:ring-app-accent transition-all aspect-square"
              >
                <img src={gif.tiny} alt={gif.title} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-app-border">
        <span className="text-[9px] text-app-text-muted/40">Powered by Tenor</span>
      </div>
    </div>
  )
}
