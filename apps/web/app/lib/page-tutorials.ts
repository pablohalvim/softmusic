export interface PageTutorialSection {
  title: string;
  body: string;
}

export interface PageTutorial {
  id: string;
  title: string;
  summary: string;
  sections: PageTutorialSection[];
}

const tutorials: PageTutorial[] = [
  {
    id: "home",
    title: "Início",
    summary: "Sua porta de entrada no SoftMusic: próximos ensaios, convites e atalhos principais.",
    sections: [
      {
        title: "O que fazer aqui",
        body: "Veja compromissos próximos, aceite convites de banda e use os atalhos para analisar uma música, abrir o dashboard ou gerenciar suas bandas.",
      },
      {
        title: "Banda ativa",
        body: "No topo, o seletor de banda define o contexto da biblioteca, agenda e análises. Troque a banda antes de analisar ou criar escalas.",
      },
    ],
  },
  {
    id: "login",
    title: "Entrar",
    summary: "Acesse sua conta com e-mail ou CPF.",
    sections: [
      {
        title: "Credenciais",
        body: "Use o e-mail cadastrado ou o CPF (somente números ou formatado). Se esqueceu a senha, use “Esqueci a senha”.",
      },
    ],
  },
  {
    id: "cadastro",
    title: "Criar conta",
    summary: "Cadastro de músico ou responsável pela banda.",
    sections: [
      {
        title: "Dados",
        body: "Preencha nome, documento e senha. Se chegou por convite, o token já vem na URL e você entra direto na banda após criar a conta.",
      },
    ],
  },
  {
    id: "esqueci-senha",
    title: "Recuperar senha",
    summary: "Receba um código por e-mail e defina uma nova senha.",
    sections: [
      {
        title: "Passos",
        body: "Informe o e-mail, digite o código recebido e escolha a nova senha. O código expira em poucos minutos.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    summary: "Visão rápida da banda ativa: análises, filas e músicas recentes.",
    sections: [
      {
        title: "Métricas",
        body: "Acompanhe quantas músicas já foram analisadas, jobs em andamento e falhas. Os números são da banda selecionada no topo.",
      },
      {
        title: "Próximos passos",
        body: "Use os cards de agenda e convites para não perder ensaios. Na biblioteca você adiciona ou reprocessa músicas.",
      },
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    summary: "Todos os ensaios e eventos da banda, em lista por data.",
    sections: [
      {
        title: "Como usar",
        body: "Toque em um compromisso para ver detalhes, músicas e integrantes. Novas escalas são criadas em Bandas → Gerenciar → Agenda.",
      },
      {
        title: "E-mails e calendário",
        body: "Ao criar ou alterar uma escala, os integrantes recebem e-mail com arquivo .ics para salvar no Google Agenda ou Apple Calendar.",
      },
    ],
  },
  {
    id: "agenda-detail",
    title: "Detalhe do compromisso",
    summary: "Repertório, integrantes e local do ensaio ou evento.",
    sections: [
      {
        title: "Repertório",
        body: "Veja as músicas escaladas e abra a cifra direto daqui. O tom e a ordem ajudam o ensaio a fluir.",
      },
      {
        title: "Local",
        body: "O endereço pode abrir a rota no mapa. Confirme o horário e quem toca cada função.",
      },
    ],
  },
  {
    id: "library",
    title: "Biblioteca",
    summary: "Músicas da banda: analisar, importar cifra, abrir player e stems.",
    sections: [
      {
        title: "Nova música",
        body: "Adicione por YouTube, arquivo de áudio ou importe da biblioteca global. Depois acompanhe o progresso da análise.",
      },
      {
        title: "Cifra e áudio",
        body: "Abra a cifra para treinar com o player, metrônomo e stems Demucs (faixas separadas). Você pode criar variações e corrigir o tom.",
      },
      {
        title: "Reanalisar",
        body: "Se o áudio ou a separação não ficaram bons, use reanalisar com outro arquivo ou link do YouTube.",
      },
    ],
  },
  {
    id: "analyze",
    title: "Analisar música",
    summary: "Envie um áudio ou link para a IA gerar harmonia, ritmo e estrutura.",
    sections: [
      {
        title: "Fontes",
        body: "Cole um link do YouTube ou envie um arquivo. A análise roda em segundo plano — você pode acompanhar no job e na biblioteca.",
      },
      {
        title: "Resultado",
        body: "Ao concluir, a música fica disponível com cifra estimada, BPM, stems e ferramentas de ensaio.",
      },
    ],
  },
  {
    id: "bandas",
    title: "Bandas",
    summary: "Crie bandas, escolha o plano e gerencie convites.",
    sections: [
      {
        title: "Criar ou entrar",
        body: "Crie uma banda nova (plano individual ou banda) ou aceite um convite pendente. A banda ativa controla o restante do app.",
      },
      {
        title: "Gerenciar",
        body: "Em cada banda você define funções (ministro, baixo, etc.), membros, agenda e plano.",
      },
    ],
  },
  {
    id: "band-manage",
    title: "Gerenciar banda",
    summary: "Funções, membros, agenda e plano da banda.",
    sections: [
      {
        title: "Funções",
        body: "Cadastre os papéis da equipe (ex.: teclado, vocal). Eles aparecem na escala e nos e-mails.",
      },
      {
        title: "Membros",
        body: "Convide por e-mail, atribua funções e permissões (analisar, convidar, gerenciar). O responsável não pode ser removido.",
      },
      {
        title: "Agenda",
        body: "Crie ensaios e eventos com local, horário, integrantes e repertório. Todos recebem o convite por e-mail.",
      },
      {
        title: "Plano",
        body: "Altere o limite de membros quando precisar. A cobrança segue o plano da conta.",
      },
    ],
  },
  {
    id: "agenda-form",
    title: "Nova / editar escala",
    summary: "Monte o ensaio: quando, onde, quem e o que tocar.",
    sections: [
      {
        title: "Campos principais",
        body: "Defina tipo (ensaio/evento), data/hora, endereço e título. Salve endereços frequentes para reutilizar.",
      },
      {
        title: "Integrantes e músicas",
        body: "Marque quem toca e em quais funções, e monte o repertório com o tom desejado para cada música.",
      },
    ],
  },
  {
    id: "faturas",
    title: "Faturas",
    summary: "Cobranças da sua conta: boletos, Pix e histórico.",
    sections: [
      {
        title: "Pagamento",
        body: "Abra o link da fatura para pagar. Bandas isentas ou em trial podem não ter cobrança ativa.",
      },
      {
        title: "Inadimplência",
        body: "Faturas em atraso podem bloquear recursos até a regularização. Em dúvida, fale com o suporte SoftMusic.",
      },
    ],
  },
  {
    id: "song",
    title: "Detalhe da música",
    summary: "Resultado da análise: harmonia, ritmo, stems e atalho para a cifra.",
    sections: [
      {
        title: "Painéis",
        body: "Explore campo harmônico, mapa da música e faixas Demucs. Use “Abrir cifra” para ensaiar com o player.",
      },
    ],
  },
  {
    id: "cifra",
    title: "Cifra e ensaio",
    summary: "Cifra, player, stems, metrônomo e variações — o coração do treino.",
    sections: [
      {
        title: "Player",
        body: "Toque a música original ou as stems. Desmarque o instrumento que você toca para treinar “sem a sua faixa”.",
      },
      {
        title: "Tom e variações",
        body: "Transponha com −½ / +½ tom, corrija o tom e salve variações da banda. Dá para importar cifra do Cifra Club.",
      },
      {
        title: "Metrônomo e rolagem",
        body: "Sincronize o metrônomo com o áudio e use a rolagem automática da cifra no ensaio.",
      },
    ],
  },
  {
    id: "job",
    title: "Progresso da análise",
    summary: "Acompanhe o job enquanto a IA processa a música.",
    sections: [
      {
        title: "Etapas",
        body: "Download, preparação de áudio, separação Demucs e análise harmônica. Ao terminar, a música aparece na biblioteca.",
      },
    ],
  },
  {
    id: "convite",
    title: "Convite de banda",
    summary: "Aceite o convite para entrar na banda.",
    sections: [
      {
        title: "Como aceitar",
        body: "Se já tiver conta, entre e aceite. Se for novo, crie a conta pelo link — o convite é vinculado automaticamente.",
      },
    ],
  },
];

const byId = Object.fromEntries(tutorials.map((t) => [t.id, t])) as Record<string, PageTutorial>;

export function resolvePageTutorial(pathname: string): PageTutorial | null {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return byId.home;
  if (path === "/login") return byId.login;
  if (path === "/cadastro") return byId.cadastro;
  if (path === "/esqueci-senha") return byId["esqueci-senha"];
  if (path === "/dashboard") return byId.dashboard;
  if (path === "/agenda") return byId.agenda;
  if (path === "/library") return byId.library;
  if (path === "/analyze") return byId.analyze;
  if (path === "/bandas") return byId.bandas;
  if (path === "/faturas") return byId.faturas;
  if (path === "/convite") return byId.convite;
  if (path === "/go/maps") return null;

  if (/^\/agenda\/[^/]+\/[^/]+$/.test(path)) return byId["agenda-detail"];
  if (/^\/bandas\/[^/]+\/agenda\/nova$/.test(path)) return byId["agenda-form"];
  if (/^\/bandas\/[^/]+\/agenda\/[^/]+\/editar$/.test(path)) return byId["agenda-form"];
  if (/^\/bandas\/[^/]+$/.test(path)) return byId["band-manage"];
  if (/^\/songs\/[^/]+\/cifra$/.test(path)) return byId.cifra;
  if (/^\/songs\/[^/]+$/.test(path)) return byId.song;
  if (/^\/jobs\/[^/]+$/.test(path)) return byId.job;

  return {
    id: "generic",
    title: "SoftMusic",
    summary: "Plataforma de análise musical e ensaio para bandas.",
    sections: [
      {
        title: "Navegação",
        body: "Use o menu superior para ir ao Dashboard, Agenda, Biblioteca, Bandas e Faturas. O botão ? explica a tela em que você está.",
      },
    ],
  };
}
