import Avatar from '../ui/Avatar'

export default function AutocompleteDropdown({ items, activeIdx, onSelect }) {
  if (items.length === 0) return (
    <div className="px-3 shrink-0">
      <div className="rounded-lg glass border border-void-border p-2 animate-fade-in">
        <p className="text-text-muted text-xs font-mono text-center">no matches</p>
      </div>
    </div>
  )

  return (
    <div className="px-3 shrink-0">
      <div className="rounded-lg glass border border-void-border p-1 animate-fade-in max-h-40 overflow-y-auto">
        {items.map((item, i) => {
          const isActive = i === activeIdx
          if (item.type === 'grok') {
            const nextItem = items[i + 1]
            return (
              <div key={item.cmd}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-left ${isActive ? 'bg-void-lighter' : 'hover:bg-void-lighter'}`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <div>
                    <span className="text-sm text-neon-cyan">{item.label}</span>
                    <span className="text-[10px] text-text-muted font-mono block">{item.desc}</span>
                  </div>
                </button>
                {nextItem?.type === 'member' && <div className="border-t border-void-border my-1" />}
              </div>
            )
          }
          return (
            <button
              key={item.uid}
              type="button"
              onClick={() => onSelect(item)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-left ${isActive ? 'bg-void-lighter' : 'hover:bg-void-lighter'}`}
            >
              <Avatar src={item.photoURL} name={item.displayName} size="xs" />
              <span className="text-sm text-text-primary">{item.displayName}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
