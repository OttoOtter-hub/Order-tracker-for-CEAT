import { formatPiTitle } from "./format-pi-title";
import {
  ContainerArrivalExpectedPayload,
  LoadListEventPayload,
  PiReadyToSignPayload,
  PiReplacementProposedPayload,
} from "../notification-events";

export interface EmailContent {
  subject: string;
  text: string;
}

/**
 * Bilingual body: nothing in the data model records a per-user language
 * preference (the frontend's RU/EN toggle only lives in the browser), so
 * every notification email carries both languages rather than guessing —
 * same "RU / EN" pairing already used for bilingual UI labels (see README,
 * arrival marker badges).
 */
function bilingual(ru: string, en: string): string {
  return `${ru}\n\n${en}`;
}

export function buildPiReadyToSignContent(
  payload: PiReadyToSignPayload,
): EmailContent {
  const title = formatPiTitle(payload.piNumber, payload.label);
  return {
    subject: bilingualSubject(
      `Проформа ${title} готова к подписанию`,
      `Proforma ${title} is ready to sign`,
    ),
    text: bilingual(
      `Проформа ${title} готова к подписанию.`,
      `Proforma ${title} is ready to sign.`,
    ),
  };
}

export function buildPiReplacementProposedContent(
  payload: PiReplacementProposedPayload,
): EmailContent {
  return {
    subject: bilingualSubject(
      `CEAT предложил замену файла проформы ${payload.piNumber}`,
      `CEAT proposed a replacement file for proforma ${payload.piNumber}`,
    ),
    text: bilingual(
      `CEAT предложил замену файла проформы ${payload.piNumber}.`,
      `CEAT proposed a replacement file for proforma ${payload.piNumber}.`,
    ),
  };
}

export function buildContainerArrivalExpectedContent(
  payload: ContainerArrivalExpectedPayload,
): EmailContent {
  return {
    subject: bilingualSubject(
      `Контейнер ${payload.containerNumber} ожидается через ${payload.daysUntilEta} дней (ETA ${payload.eta})`,
      `Container ${payload.containerNumber} expected in ${payload.daysUntilEta} days (ETA ${payload.eta})`,
    ),
    text: bilingual(
      `Контейнер ${payload.containerNumber} ожидается через ${payload.daysUntilEta} дней (ETA ${payload.eta}).`,
      `Container ${payload.containerNumber} expected in ${payload.daysUntilEta} days (ETA ${payload.eta}).`,
    ),
  };
}

function bilingualSubject(ru: string, en: string): string {
  return `${ru} / ${en}`;
}

const PAGE_HINT_RU = "Откройте раздел «Готово к отгрузке» на loadlist.info.";
const PAGE_HINT_EN = 'Open "Ready to ship" on loadlist.info.';

function loadListContent(
  ru: string,
  en: string,
  extraRu = "",
  extraEn = "",
): EmailContent {
  return {
    subject: bilingualSubject(ru, en),
    text: bilingual(
      `${ru}.${extraRu}\n${PAGE_HINT_RU}`,
      `${en}.${extraEn}\n${PAGE_HINT_EN}`,
    ),
  };
}

/** Phase 25, to the client: CEAT sent the load list for review. */
export function buildLoadListSentContent(): EmailContent {
  return loadListContent(
    "CEAT отправил load list на согласование",
    "CEAT sent you the load list for review",
  );
}

/** Phase 25, to the client: CEAT accepted their changes. */
export function buildLoadListApprovedContent(): EmailContent {
  return loadListContent(
    "CEAT подтвердил ваши правки load list",
    "CEAT approved your changes to the load list",
  );
}

/** Phase 25, to the client: CEAT rejected their changes — comment and cuts included. */
export function buildLoadListRejectedContent(
  p: LoadListEventPayload,
): EmailContent {
  const cuts = (p.adjustments ?? []).map(
    (a) =>
      `${a.materialNum ?? "—"} (PI ${a.piNumber}), ${a.containerLabel}: ${a.wanted} → ${a.placed}`,
  );
  return loadListContent(
    "CEAT отклонил ваши правки load list",
    "CEAT rejected your changes to the load list",
    `\nКомментарий CEAT: ${p.comment ?? ""}` +
      (cuts.length
        ? `\nПо текущим остаткам уменьшено: ${cuts.join("; ")}`
        : ""),
    `\nCEAT's comment: ${p.comment ?? ""}` +
      (cuts.length ? `\nCut to the current stock: ${cuts.join("; ")}` : ""),
  );
}

/** Phase 25, to CEAT: the client accepted the load list as sent. */
export function buildLoadListAcceptedContent(
  p: LoadListEventPayload,
): EmailContent {
  return loadListContent(
    `${p.customerName}: клиент принял load list`,
    `${p.customerName}: the client accepted the load list`,
  );
}

/** Phase 25, to CEAT: the client asked to edit (editing is open at once). */
export function buildLoadListEditRequestedContent(
  p: LoadListEventPayload,
): EmailContent {
  return loadListContent(
    `${p.customerName}: клиент начал редактировать load list`,
    `${p.customerName}: the client is editing the load list`,
  );
}

/** Phase 25, to CEAT: the client submitted their version. */
export function buildLoadListSubmittedContent(
  p: LoadListEventPayload,
): EmailContent {
  return loadListContent(
    `${p.customerName}: клиент отправил правки load list`,
    `${p.customerName}: the client submitted changes to the load list`,
  );
}
