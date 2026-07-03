import { useEffect, useRef, useState } from "react";

import { cleanDigits } from "./br-format";

export interface ViaCepAddress {
  street: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface ViaCepResponse {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export function useViaCep(
  cep: string,
  onFill: (data: ViaCepAddress) => void,
  enabled = true,
): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFillRef = useRef(onFill);
  onFillRef.current = onFill;

  useEffect(() => {
    const clean = cleanDigits(cep);
    if (!enabled || clean.length !== 8) {
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${clean}/json/`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Serviço de CEP indisponível");
        }
        const data = (await response.json()) as ViaCepResponse;
        if (data.erro) {
          setError("CEP não encontrado");
          return;
        }
        onFillRef.current({
          street: data.logradouro ?? "",
          complement: data.complemento ?? "",
          neighborhood: data.bairro ?? "",
          city: data.localidade ?? "",
          state: (data.uf ?? "").toUpperCase(),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Não foi possível buscar o CEP");
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cep, enabled]);

  return { loading, error };
}
