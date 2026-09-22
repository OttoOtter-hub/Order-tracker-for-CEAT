import { formatPiTitle } from "./format-pi-title";
import {
  ContainerArrivalExpectedPayload,
  ContainerReopenedForClientPayload,
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

export function buildContainerReopenedForClientContent(
  payload: ContainerReopenedForClientPayload,
): EmailContent {
  return {
    subject: bilingualSubject(
      `Контейнер ${payload.label} предложен на подтверждение`,
      `Container ${payload.label} is ready for your confirmation`,
    ),
    text: bilingual(
      `Контейнер ${payload.label} предложен на подтверждение.`,
      `Container ${payload.label} is ready for your confirmation.`,
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
