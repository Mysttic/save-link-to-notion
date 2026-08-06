import { useState } from 'react';

interface TagPickerProps {
    options: string[];
    value: string[];
    onChange: (tags: string[]) => void;
}

export function TagPicker({ options, value, onChange }: TagPickerProps) {
    const [draft, setDraft] = useState('');
    // Typed tags are remembered separately from the selection, otherwise
    // deselecting one would remove its chip and there would be no way back.
    const [typed, setTyped] = useState<string[]>([]);

    const toggle = (tag: string) => {
        onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
    };

    const commitDraft = () => {
        const tag = draft.trim();
        setDraft('');
        if (!tag) return;
        if (!value.includes(tag)) onChange([...value, tag]);
        if (!options.includes(tag)) {
            setTyped((previous) => (previous.includes(tag) ? previous : [...previous, tag]));
        }
    };

    // Filtering the union keeps a typed tag from rendering twice once the
    // database schema arrives and already contains it.
    const custom = [...new Set([...typed, ...value])].filter((tag) => !options.includes(tag));

    return (
        <div>
            <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wider">
                Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {[...options, ...custom].map((tag) => {
                    const selected = value.includes(tag);
                    return (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => toggle(tag)}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                selected
                                    ? 'bg-indigo-600/70 border-indigo-400 text-white'
                                    : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500'
                            }`}
                        >
                            {tag}
                        </button>
                    );
                })}
                {options.length === 0 && custom.length === 0 && (
                    <span className="text-[11px] text-neutral-600">
                        No tags in the database yet — type one below.
                    </span>
                )}
            </div>
            <input
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commitDraft();
                    }
                }}
                onBlur={commitDraft}
                placeholder="Add a tag and press Enter"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
            />
        </div>
    );
}
