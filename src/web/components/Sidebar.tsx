import type { SectionView } from '../lib/rows.js';
import type { GroupCategory, SessionSnapshot } from '../lib/types.js';
import { Icon } from './icons.js';
import { Donut, Kbd, Label } from './ui.js';

const CATEGORY_TONE: Partial<Record<GroupCategory, 'danger' | 'attention' | 'success' | 'done' | 'accent'>> = {
  security: 'danger', core: 'done', api: 'accent', data: 'attention', ui: 'success', tests: 'success',
};

function counts(section: SectionView) {
  let add = 0;
  let del = 0;
  for (const f of section.files) {
    for (const i of f.layout.hunks) {
      for (const l of f.meatFile.hunks[i]?.hunk.lines ?? []) {
        if (l.kind === 'add') add += 1; else if (l.kind === 'del') del += 1;
      }
    }
  }
  return { add, del };
}

export function Sidebar({
  page, snapshot, mode, onMode, activeSection, activeFile, onJumpSection, onJumpFile, findingCount,
}: {
  page: SectionView[];
  snapshot: SessionSnapshot;
  mode: 'groups' | 'files';
  onMode: () => void;
  activeSection: string | null;
  activeFile: number | null;
  onJumpSection: (key: string) => void;
  onJumpFile: (fileIndex: number) => void;
  findingCount: (sectionKey: string) => number;
}) {
  const isViewed = (path: string) => snapshot.viewed[path] !== undefined && snapshot.viewed[path] === snapshot.fileHashes[path];
  const files = snapshot.meat?.files ?? [];
  const tab = (name: 'groups' | 'files', label: string) => (
    <button
      type="button"
      onClick={() => mode !== name && onMode()}
      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${mode === name ? 'bg-canvas text-fg shadow-sm ring-1 ring-border' : 'text-fg-muted hover:text-fg'}`}
      aria-pressed={mode === name}
    >
      {label}
    </button>
  );

  return (
    <nav className="flex h-full flex-col border-r border-border bg-canvas" aria-label="Review outline">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="flex flex-1 gap-1 rounded-lg bg-canvas-subtle p-0.5">
          {tab('groups', 'Groups')}
          {tab('files', 'Files')}
        </div>
        <span className="text-fg-muted"><Kbd>g</Kbd></span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {mode === 'groups' ? page.map(({ section, files: sectionFiles }) => {
          const { add, del } = counts({ section, files: sectionFiles });
          const viewed = sectionFiles.filter((f) => isViewed(f.meatFile.file.path)).length;
          const findings = findingCount(section.key);
          const active = activeSection === section.key;
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => onJumpSection(section.key)}
              className={`relative block w-full px-3 py-2 text-left hover:bg-canvas-subtle ${active ? 'bg-accent-subtle' : ''} ${section.depth === 1 ? 'pl-7' : ''}`}
            >
              {active && <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-accent-emphasis" />}
              <div className="flex items-center gap-2">
                <Donut done={viewed} total={sectionFiles.length} />
                <span className={`min-w-0 flex-1 truncate text-sm ${section.kind === 'group' ? 'font-medium' : 'text-fg-muted italic'}`}>{section.label}</span>
                {findings > 0 && <span className="rounded-full bg-done px-1.5 text-[11px] leading-4 font-semibold text-white">{findings}</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-6 text-[11px] text-fg-muted">
                {section.kind === 'group' && <Label tone={CATEGORY_TONE[section.category] ?? 'muted'}>{section.category}</Label>}
                <span>{sectionFiles.length} file{sectionFiles.length === 1 ? '' : 's'}</span>
                <span className="font-mono"><span className="text-success">+{add}</span> <span className="text-danger">−{del}</span></span>
              </div>
            </button>
          );
        }) : files.map((f, i) => (
          <button
            key={f.file.path}
            type="button"
            onClick={() => onJumpFile(i)}
            className={`relative flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-canvas-subtle ${activeFile === i ? 'bg-accent-subtle' : ''}`}
          >
            {activeFile === i && <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-accent-emphasis" />}
            <Icon name={isViewed(f.file.path) ? 'checkCircle' : 'file'} size={14} className={isViewed(f.file.path) ? 'text-success' : 'text-fg-muted'} />
            <span className={`min-w-0 flex-1 truncate font-mono text-xs ${f.dropped || f.hunks.every((h) => !h.keep) ? 'text-fg-muted line-through decoration-fg-muted/40' : ''}`} title={f.file.path}>
              {f.file.path.split('/').pop()}
              <span className="ml-1 text-fg-muted">{f.file.path.split('/').slice(0, -1).join('/')}</span>
            </span>
            <span className="font-mono text-[11px]"><span className="text-success">+{f.file.additions}</span> <span className="text-danger">−{f.file.deletions}</span></span>
          </button>
        ))}
      </div>
    </nav>
  );
}
