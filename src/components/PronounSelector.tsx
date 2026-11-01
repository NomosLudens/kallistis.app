import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

const CUSTOM = "__custom_pronouns__";

const PRONOUN_OPTIONS = [
  { value: "ela/dela", label: "Ela/dela" },
  { value: "ele/dele", label: "Ele/dele" },
  { value: "elu/delu", label: "Elu/delu" },
  { value: "ile/dile", label: "Ile/dile" },
  { value: "ilu/dilu", label: "Ilu/dilu" },
  { value: "el/del", label: "El/del" },
  { value: "qualquer pronome", label: "Qualquer pronome" },
  { value: "usar meu nome", label: "Pode usar meu nome" },
  { value: "prefiro não informar", label: "Prefiro não informar" },
] as const;

const PRESET_VALUES = new Set<string>(PRONOUN_OPTIONS.map((option) => option.value));

type PronounSelectorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  selectClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  helperClassName?: string;
};

export function PronounSelector({
  id,
  label,
  value,
  onChange,
  required = false,
  selectClassName,
  labelClassName,
  inputClassName,
  helperClassName,
}: PronounSelectorProps) {
  const [customMode, setCustomMode] = useState(
    () => Boolean(value) && !PRESET_VALUES.has(value),
  );

  useEffect(() => {
    if (value) setCustomMode(!PRESET_VALUES.has(value));
  }, [value]);

  const selectedValue = customMode ? CUSTOM : value;

  return (
    <div>
      <label htmlFor={id} className={labelClassName ?? "block"}>
        {label}
      </label>
      <select
        id={id}
        value={selectedValue}
        required={required}
        onChange={(event) => {
          const next = event.target.value;
          if (next === CUSTOM) {
            setCustomMode(true);
            onChange("");
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
        className={selectClassName}
      >
        <option value="">Selecione seus pronomes</option>
        {PRONOUN_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM}>Outro conjunto ou combinação</option>
      </select>
      {customMode ? (
        <Input
          id={`${id}-custom`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
          required={required}
          placeholder="Escreva como prefere (até 80 caracteres)"
          className={inputClassName}
          aria-label={`${label}: outro conjunto ou combinação`}
        />
      ) : null}
      <p className={helperClassName}>
        A lista é um ponto de partida. Você pode escrever qualquer combinação ou forma que use.
      </p>
    </div>
  );
}
