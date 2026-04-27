export type Persona = "qa" | "dev" | "qmo";

interface PersonaToggleProps {
  persona: Persona;
  onChange: (next: Persona) => void;
}

const PERSONAS: ReadonlyArray<{ id: Persona; label: string }> = [
  { id: "qa", label: "QA" },
  { id: "dev", label: "Developer" },
  { id: "qmo", label: "Insights" }
];

export function PersonaToggle({ persona, onChange }: PersonaToggleProps) {
  return (
    <div className="persona" role="tablist" aria-label="Persona view">
      {PERSONAS.map((p) => (
        <button
          key={p.id}
          role="tab"
          aria-pressed={persona === p.id}
          data-persona={p.id}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
