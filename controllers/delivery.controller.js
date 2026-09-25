import Store from '../models/store.js';
import Delivery from '../models/delivery.js';
import Rider from '../models/rider.js';
import { getOrCreateSettings } from '../models/settings.js';
import { distanceBetween } from '../utils/googleMaps.js';
import { buildStoreAddressText } from '../utils/address.js';
import { todayBrazilRange, weekBrazilRange, monthBrazilRange, lastNDaysBrazilRange } from '../utils/brazilDate.js';
import { notifyStore } from '../websocket.js';
import { notifyNewDeliveryAvailable, notifyRiderDeliveryCancelled } from '../utils/pushNotifications.js';
import { matchedData } from 'express-validator';


// TODO: substituir por um cálculo real (baseado em distância, categoria do
// pacote, demanda/hora, taxa mínima etc.) quando essa regra de negócio for
// definida. Por enquanto gera um valor aleatório só para termos o dado
// preenchido e podermos avançar no front do rider.
function calculateRiderPayout(km) {
  const BASE = 8.55;
  const PRECO_KM = 1.6;
  const MINIMO = 8;
  const LIMITE_LINEAR = 15;
  const EXTRA_REAIS = 2;
  const EXTRA_A_CADA_KM = 3;

  if (km == null || km < 0) return MINIMO;

  let taxa = BASE + PRECO_KM * km;

  if (km > LIMITE_LINEAR) {
    const kmExcedentes = km - LIMITE_LINEAR;
    const blocos = Math.ceil(kmExcedentes / EXTRA_A_CADA_KM);
    taxa += blocos * EXTRA_REAIS;
  }

  return Math.max(MINIMO, Math.round(taxa));
}

// Calcula e "cobra" a taxa da plataforma referente a UMA entrega concluída.
// Chamada só depois que a transição de status para 4 (entregue) já foi
// confirmada de forma atômica em deliverDelivery — ou seja, roda no máximo
// uma vez por entrega, sem risco de dupla contagem em corrida.
//
// Prioridade: se a loja ainda tem saldo de entregas grátis, consome 1
// crédito (de forma atômica, via findOneAndUpdate com $gt:0 — evita duas
// entregas concluídas ao mesmo tempo consumirem o mesmo crédito) e a taxa
// fica 0. Só quando não há mais saldo é que se aplica a taxa vigente em
// Settings.
async function chargePlatformFeeForDelivery(storeId) {
  const storeAfterConsumingCredit = await Store.findOneAndUpdate(
    { _id: storeId, freeDeliveriesRemaining: { $gt: 0 } },
    { $inc: { freeDeliveriesRemaining: -1 } },
  );

  if (storeAfterConsumingCredit) {
    return { platformFee: 0, platformFeeWaived: true };
  }

  const settings = await getOrCreateSettings();
  return { platformFee: settings.deliveryFee, platformFeeWaived: false };
}

// POST /stores/deliveries
// Cria uma nova entrega para a loja autenticada. Nenhum rider é atribuído
// neste momento (fica como null, para atribuição/aceite posterior).
//
// O destino já chega com latitude/longitude (obtidas no front via Google
// Places Autocomplete + Place Details). A distância é calculada usando as
// coordenadas de origem (loja) e destino diretamente — mais preciso e sem
// depender de geocodificação por texto.
export const createDelivery = async (req, res) => {
  try {
    const storeId = req.user?.id;
    const { destino, package: pkg } = req.body;

    const store = await Store.findById(storeId).select('name address emailVerifiedAt active city');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

    const origemAddress = buildStoreAddressText(store.address);
    const { latitude: origemLat, longitude: origemLng } = store.address ?? {};

    if (!origemAddress || origemLat == null || origemLng == null) {
      return res.status(400).json({
        error: 'Cadastre o endereço completo da loja (com localização) antes de criar uma entrega.',
      });
    }

    let distanceInfo;
    try {
      distanceInfo = await distanceBetween(
        `${origemLat},${origemLng}`,
        `${destino.latitude},${destino.longitude}`,
      );
    } catch (error) {
      console.error('Erro ao calcular distância da entrega:', error);
      return res.status(422).json({
        error: 'Não foi possível calcular a distância para o endereço informado. Verifique o endereço e tente novamente.',
      });
    }

    const delivery = new Delivery({
      store: storeId,
      city: store.city,
      rider: null,
      origem: {
        address: origemAddress,
        latitude: origemLat,
        longitude: origemLng,
      },
      destino: {
        address: destino.address,
        latitude: destino.latitude,
        longitude: destino.longitude,
        nome: destino.nome,
        telefone: destino.telefone,
      },
      // distancia é armazenada em quilômetros, com 2 casas decimais
      distancia: Math.round((distanceInfo.meters / 1000) * 100) / 100,
      riderPayout: calculateRiderPayout(Math.round((distanceInfo.meters / 1000) * 100) / 100),
      package: {
        description: pkg.description,
        category: pkg.category,
        quantity: pkg.quantity,
        weight: pkg.weight,
        declaredvalue: pkg.declaredvalue,
        notes: pkg.notes,
        payment: pkg.payment,
        amountDue: pkg.amountDue,
        cashChange: pkg.cashChange,
      },
      events: [{ data: new Date(), descricao: 'Entrega criada pela loja' }],
    });

    await delivery.save();

    notifyNewDeliveryAvailable(delivery, store.name).catch((error) => {
      console.error('Erro ao notificar riders sobre nova entrega:', error);
    });

    return res.status(201).json(delivery);
  } catch (error) {
    console.error('Erro no createDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// Verifica se o rider existe e está apto a ver/aceitar entregas (ativo,
// e-mail verificado, conta aprovada). Usado tanto em listAvailableDeliveries
// quanto em getDelivery para não duplicar essa checagem em cada endpoint.
async function findEligibleRider(riderId) {
  const rider = await Rider.findById(riderId).select('name active emailVerifiedAt accountApprovedAt city');

  if (!rider) {
    return { error: 'Entregador não encontrado.', status: 404 };
  }

  if (!rider.active) {
    return { error: 'Conta desativada.', status: 403 };
  }

  if (!rider.emailVerifiedAt) {
    return { error: 'Conta ainda não verificada.', status: 403 };
  }

  if (!rider.accountApprovedAt) {
    return { error: 'Conta ainda não aprovada.', status: 403 };
  }

  return { rider };
}

// GET /riders/deliveries/available
// Lista entregas com status "disponível" (status: 0) e sem rider atribuído,
// para o app do entregador exibir na tela principal. Inclui os dados da
// loja (nome, telefone, avatar) para o rider saber quem está solicitando.
// Restrito às entregas de lojas da MESMA cidade do rider — entregas de
// outras cidades não entram nem nesta lista nem em getDelivery (ver abaixo).
export const listAvailableDeliveries = async (req, res) => {
  try {
    const riderId = req.user?.id;

    const { rider, error, status } = await findEligibleRider(riderId);
    if (!rider) {
      return res.status(status).json({ error });
    }

    const deliveries = await Delivery.find({ status: 0, rider: null, city: rider.city })
      .populate('store', 'name avatar address.district')
      .sort({ createdAt: -1 })
      .limit(50); // evita payload gigante se acumular muita entrega parada

    return res.status(200).json(deliveries);
  } catch (error) {
    console.error('Erro no listAvailableDeliveries:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /riders/deliveries/active
// Lista as entregas do próprio rider que estão em andamento (status 1, 2
// ou 3 — aceita, retirada, a caminho), para a tela Home exibir junto com
// as disponíveis. Hoje um rider só deve ter uma entrega ativa por vez (ver
// acceptDelivery), mas a rota já devolve uma lista pensando em, no futuro,
// permitir múltiplas entregas simultâneas sem precisar mudar o contrato.
export const listActiveDeliveries = async (req, res) => {
  try {
    const riderId = req.user?.id;

    const { rider, error, status } = await findEligibleRider(riderId);
    if (!rider) {
      return res.status(status).json({ error });
    }

    const deliveries = await Delivery.find({ rider: riderId, status: { $in: [1, 2, 3] } })
      .populate('store', 'name avatar address.district')
      .sort({ acceptedAt: -1 });

    return res.status(200).json(deliveries);
  } catch (error) {
    console.error('Erro no listActiveDeliveries:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /riders/deliveries/:id
// Detalhes de uma entrega específica, para a tela de "Detalhes da entrega"
// (exibida ao tocar num card da lista de disponíveis), antes do rider
// decidir se aceita.
//
// Regra de visibilidade:
// - status 0 e sem rider atribuído → entrega "disponível", qualquer rider
//   elegível DA MESMA CIDADE DA LOJA pode ver os detalhes (é o caso de
//   pré-visualização, vindo da lista de disponíveis). De outra cidade →
//   tratada como inexistente (404), nunca 403 (não revela que existe).
// - status > 0 (já aceita) → só o rider atribuído a ela pode ver. Depois
//   que uma entrega é aceita, ela deixa de ser pública para os demais.
export const getDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;

    const { rider, error, status } = await findEligibleRider(riderId);
    if (!rider) {
      return res.status(status).json({ error });
    }

    const delivery = await Delivery.findById(id).populate('store', 'name avatar address.district');

    if (!delivery) {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }

    const isSameCity = rider.city && delivery.city && delivery.city.equals(rider.city);
    const isAvailable = delivery.status === 0 && delivery.rider == null;
    const isOwnDelivery = delivery.rider != null && delivery.rider.equals(riderId);

    if (isAvailable && !isSameCity) {
      // Disponível, mas de outra cidade: para o rider, ela simplesmente não
      // existe — não é "sem permissão" (403), que revelaria a existência.
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }

    if (!isAvailable && !isOwnDelivery) {
      return res.status(403).json({ error: 'Você não tem permissão para ver esta entrega.' });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no getDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// Helper comum a todas as transições de status feitas pelo rider: valida
// elegibilidade, aplica um update atômico condicionado ao status/rider
// atuais esperados (evita corrida entre requisições concorrentes e pulos de
// etapa) e devolve a entrega já populada, ou o motivo do erro.
//
// `filter` deve sempre conter pelo menos `status` (e, exceto no aceite,
// `rider: riderId`) para garantir que a transição só aconteça a partir do
// estado esperado.


// ... (código existente sem mudanças até chegar em transitionAsRider) ...

async function transitionAsRider({ riderId, deliveryId, filter, update, conflictMessage, notifyEvent, visibilityFilter }) {
  const { rider, error, status } = await findEligibleRider(riderId);
  if (!rider) {
    return { error, status };
  }

  // `filter` pode ser um objeto fixo (maioria dos casos, onde a posse já é
  // garantida por rider: riderId) ou uma função (rider) => filtro, usada
  // quando a condição depende de dados do rider — hoje só o aceite precisa
  // disso, para casar city: rider.city.
  const resolvedFilter = typeof filter === 'function' ? filter(rider) : filter;

  const delivery = await Delivery.findOneAndUpdate(
    { _id: deliveryId, ...resolvedFilter },
    update,
    { returnDocument: 'after' },
  ).populate('store', 'name avatar address.district');

  if (!delivery) {
    // O findOneAndUpdate acima retorna null tanto quando a entrega não
    // existe quanto quando existe mas está num status diferente do
    // esperado — precisamos diferenciar os dois pra dar o erro certo.
    // Essa checagem extra só roda no caminho de falha, então não reabre
    // a janela de corrida da transição em si (que já é atômica acima).
    //
    // `visibilityFilter` (opcional, mesma forma objeto/função de `filter`)
    // define o que conta como "existe pra este rider" nessa checagem — no
    // aceite, uma entrega de outra cidade deve aparecer como inexistente
    // (404), não como conflito (409), mesmo que exista globalmente.
    const resolvedVisibilityFilter =
      typeof visibilityFilter === 'function' ? visibilityFilter(rider) : (visibilityFilter || {});
    const exists = await Delivery.exists({ _id: deliveryId, ...resolvedVisibilityFilter });
    if (!exists) {
      return { error: 'Entrega não encontrada.', status: 404 };
    }
    return { error: conflictMessage, status: 409 };
  }

  // Avisa o painel da loja em tempo real (via WebSocket) que essa entrega
  // mudou. Se a loja não estiver com o dashboard aberto no momento, a
  // notificação simplesmente não tem destinatário — não é um erro, ela vê
  // o estado atualizado na próxima vez que abrir/atualizar a tela.
  //
  // Importante: buscamos uma cópia separada da entrega, com o rider
  // populado, só para esse payload. O `delivery` retornado abaixo é o que
  // a resposta REST devolve para o próprio rider — e essa resposta sempre
  // trouxe `rider` como o ID simples (não populado), então não podemos
  // popular o objeto original sem quebrar esse contrato já existente.
  if (notifyEvent && delivery.store) {
    const deliveryForStore = await Delivery.findById(delivery._id)
      .populate('store', 'name avatar address.district')
      .populate('rider', 'name phone avatar vehicle rating');

    notifyStore(delivery.store._id, {
      type: 'delivery:updated',
      event: notifyEvent,
      delivery: deliveryForStore,
    });
  }

  return { delivery };
}
// POST /riders/deliveries/:id/accept
// status 0 (disponível) → 1 (aceita). Só funciona se ninguém tiver
// aceitado entre o rider ver os detalhes e tocar em "Aceitar" — é isso que
// o filtro { status: 0, rider: null } garante de forma atômica. Também
// exige city: rider.city — trava no servidor a mesma regra já aplicada na
// listagem, então mesmo uma chamada direta à API (sem passar pela lista)
// não consegue aceitar entrega de outra cidade.
export const acceptDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: (rider) => ({ status: 0, rider: null, city: rider.city }),
      update: {
        status: 1,
        rider: riderId,
        acceptedAt: new Date(),
        $push: { events: { data: new Date(), descricao: 'Entrega aceita pelo entregador' } },
      },
      conflictMessage: 'Esta entrega não está mais disponível.',
      notifyEvent: 'accepted',
      // Sem isso, uma entrega de outra cidade cairia no "else" genérico e
      // devolveria 409 (conflito) em vez de 404 — revelando que ela existe.
      visibilityFilter: (rider) => ({ city: rider.city }),
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no acceptDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// POST /riders/deliveries/:id/pickup
// status 1 (aceita) → 2 (retirada). Só o rider que aceitou pode confirmar.
export const pickupDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: { status: 1, rider: riderId },
      update: {
        status: 2,
        pickedUpAt: new Date(),
        $push: { events: { data: new Date(), descricao: 'Pacote retirado pelo entregador' } },
      },
      conflictMessage: 'Não foi possível confirmar a retirada desta entrega.',
      notifyEvent: 'picked-up',
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no pickupDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// POST /riders/deliveries/:id/en-route
// status 2 (retirada) → 3 (a caminho do destino).
export const dispatchDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: { status: 2, rider: riderId },
      update: {
        status: 3,
        dispatchedAt: new Date(),
        $push: { events: { data: new Date(), descricao: 'Entregador a caminho do destino' } },
      },
      conflictMessage: 'Não foi possível atualizar esta entrega.',
      notifyEvent: 'dispatched',
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no dispatchDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// POST /riders/deliveries/:id/deliver
// status 3 (a caminho) → 4 (entregue). Estado final de sucesso.
export const deliverDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: { status: 3, rider: riderId },
      update: {
        status: 4,
        deliveredAt: new Date(),
        $push: { events: { data: new Date(), descricao: 'Pacote entregue' } },
      },
      conflictMessage: 'Não foi possível confirmar a entrega deste pacote.',
      notifyEvent: 'delivered',
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    // A transição de status acima já é atômica e só passa uma vez por
    // entrega — a partir daqui é seguro calcular e gravar a taxa da
    // plataforma sem risco de cobrar a mesma entrega duas vezes.
    const { platformFee, platformFeeWaived } = await chargePlatformFeeForDelivery(delivery.store._id ?? delivery.store);
    delivery.platformFee = platformFee;
    delivery.platformFeeWaived = platformFeeWaived;
    await delivery.save();

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no deliverDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// POST /riders/deliveries/:id/return
// status 2 ou 3 (pacote já em posse do rider) → 5 (devolvida à loja).
// Usado quando o cliente recusa/não é encontrado etc. Exige `motivo`.
export const returnDelivery = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;
    const { motivo } = req.body;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: { status: { $in: [2, 3] }, rider: riderId },
      update: {
        status: 5,
        cancelReason: motivo,
        $push: { events: { data: new Date(), descricao: `Pacote devolvido à loja: ${motivo}` } },
      },
      conflictMessage: 'Não foi possível registrar a devolução desta entrega.',
      notifyEvent: 'returned',
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no returnDelivery:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// POST /riders/deliveries/:id/cancel
// status 1 (aceita, ainda NÃO retirada) → volta para 0, com rider: null.
// Cancelamento do rider antes de pegar o pacote não é um estado terminal:
// a entrega reabre no pool para outro rider aceitar, em vez de forçar a
// loja a recriar tudo do zero. Depois da retirada (status 2/3), o rider já
// não pode mais "cancelar" — o caminho correto nesse ponto é /return.
export const cancelDeliveryByRider = async (req, res) => {
  try {
    const riderId = req.user?.id;
    const { id } = req.params;
    const { motivo } = req.body;

    const { delivery, error, status } = await transitionAsRider({
      riderId,
      deliveryId: id,
      filter: { status: 1, rider: riderId },
      update: {
        status: 0,
        rider: null,
        acceptedAt: null,
        $push: { events: { data: new Date(), descricao: `Entrega cancelada pelo entregador: ${motivo}` } },
      },
      conflictMessage: 'Não foi possível cancelar esta entrega.',
      notifyEvent: 'cancelled_by_rider',
    });

    if (!delivery) {
      return res.status(status).json({ error });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no cancelDeliveryByRider:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /riders/deliveries/stats/summary
// Resumo para a tela "Meus Ganhos" (e também para o mini-dashboard da
// Home, que usa só o campo `today`): valor faturado (soma de riderPayout)
// e quantidade de entregas concluídas em três períodos, numa única
// requisição — Dia, Semana e Mês, todos ancorados no calendário civil de
// Brasília (não UTC) e terminando "agora" (nunca no fim do período, já que
// dias futuros não têm entrega mesmo). Semana começa na segunda-feira.
//
// Só conta status 4 (entregue) — devolvida/cancelada não é faturamento.
// Usa deliveredAt (não createdAt): o que importa é quando a entrega foi
// CONCLUÍDA, não quando foi solicitada pela loja.
//
// Implementado como um único aggregate com $facet: a query base (rider +
// status=4 + deliveredAt dentro do maior intervalo, o do mês, que sempre
// contém os outros dois) roda uma vez só, e cada faceta refina com seu
// próprio $match — mais barato que rodar 3 agregações/queries separadas.
export const getRiderEarningsSummary = async (req, res) => {
  try {
    const riderId = req.user?.id;

    const { rider, error, status } = await findEligibleRider(riderId);
    if (!rider) {
      return res.status(status).json({ error });
    }

    const now = new Date();
    const today = todayBrazilRange(now);
    const week = weekBrazilRange(now);
    const month = monthBrazilRange(now);

    const [result] = await Delivery.aggregate([
      {
        $match: {
          rider: rider._id,
          status: 4,
          deliveredAt: { $gte: month.start, $lte: month.end },
        },
      },
      {
        $facet: {
          today: [
            { $match: { deliveredAt: { $gte: today.start, $lte: today.end } } },
            { $group: { _id: null, earnings: { $sum: '$riderPayout' }, deliveries: { $sum: 1 } } },
          ],
          week: [
            { $match: { deliveredAt: { $gte: week.start, $lte: week.end } } },
            { $group: { _id: null, earnings: { $sum: '$riderPayout' }, deliveries: { $sum: 1 } } },
          ],
          month: [
            { $group: { _id: null, earnings: { $sum: '$riderPayout' }, deliveries: { $sum: 1 } } },
          ],
        },
      },
    ]);

    const pick = (bucket) => ({
      earnings: bucket?.[0]?.earnings ?? 0,
      deliveries: bucket?.[0]?.deliveries ?? 0,
    });

    return res.status(200).json({
      today: pick(result?.today),
      week: pick(result?.week),
      month: pick(result?.month),
    });
  } catch (error) {
    console.error('Erro no getRiderEarningsSummary:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /stores/deliveries/dashboard
// Dados agregados para o dashboard da loja — sem nenhuma métrica de
// faturamento/receita da loja (fora do escopo da plataforma). Tudo aqui é
// sobre a OPERAÇÃO de entrega em si:
//
// - now: indicadores do momento atual (não são por período) —
//   quantas entregas estão aguardando entregador e quantas em andamento
//   agora mesmo.
// - today/week/month: para cada período (dia civil de Brasília, semana
//   começando segunda, mês civil — mesma convenção usada em
//   getRiderEarningsSummary), conta quantas entregas foram solicitadas,
//   quantas concluídas, quantas canceladas/devolvidas, tempo médio até o
//   aceite e até a conclusão (em minutos), distância total percorrida e o
//   total de repasse pago aos entregadores (custo operacional da loja —
//   não é receita, mas ainda assim dinheiro que sai do caixa, por isso
//   incluído a pedido).
// - chart: série diária dos últimos 30 dias (rolante, não reinicia com o
//   calendário) com solicitadas x concluídas, para visualizar tendência.
// - topRiders: os 5 entregadores que mais concluíram entregas para esta
//   loja no mês corrente.
// - categoryBreakdown: quantas entregas por categoria de pacote no mês
//   corrente.
//
// Implementado como um único aggregate com $facet — evita várias idas ao
// banco para montar a tela toda de uma vez.
function buildPeriodGroupStage() {
  return {
    $group: {
      _id: null,
      requested: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$status', 4] }, 1, 0] } },
      cancelledOrReturned: { $sum: { $cond: [{ $in: ['$status', [5, 6]] }, 1, 0] } },
      totalDistance: { $sum: { $cond: [{ $eq: ['$status', 4] }, '$distancia', 0] } },
      totalRiderPayout: { $sum: { $cond: [{ $eq: ['$status', 4] }, '$riderPayout', 0] } },
      // Taxa da plataforma cobrada da loja nas entregas concluídas do
      // período, e quantas dessas vieram isentas pelo saldo de entregas
      // grátis (platformFee só existe — não é null — em entregas com
      // status 4, então o $cond por status é redundante mas mantido pra
      // ficar simétrico com totalRiderPayout acima).
      totalPlatformFee: { $sum: { $cond: [{ $eq: ['$status', 4] }, { $ifNull: ['$platformFee', 0] }, 0] } },
      freeDeliveriesUsedCount: { $sum: { $cond: [{ $eq: ['$platformFeeWaived', true] }, 1, 0] } },
      sumAcceptMinutes: {
        $sum: {
          $cond: [
            { $ne: ['$acceptedAt', null] },
            { $divide: [{ $subtract: ['$acceptedAt', '$createdAt'] }, 60000] },
            0,
          ],
        },
      },
      countAccepted: { $sum: { $cond: [{ $ne: ['$acceptedAt', null] }, 1, 0] } },
      sumDeliveryMinutes: {
        $sum: {
          $cond: [
            { $and: [{ $ne: ['$deliveredAt', null] }, { $ne: ['$acceptedAt', null] }] },
            { $divide: [{ $subtract: ['$deliveredAt', '$acceptedAt'] }, 60000] },
            0,
          ],
        },
      },
      countDelivered: {
        $sum: { $cond: [{ $and: [{ $ne: ['$deliveredAt', null] }, { $ne: ['$acceptedAt', null] }] }, 1, 0] },
      },
    },
  };
}

// Converte o bucket bruto do $group acima no formato final da resposta,
// já calculando as médias (que não dá pra fazer dentro do $group sem antes
// somar tudo).
function pickPeriodStats(bucket) {
  const b = bucket?.[0];
  if (!b) {
    return {
      requested: 0,
      completed: 0,
      cancelledOrReturned: 0,
      totalDistance: 0,
      totalRiderPayout: 0,
      totalPlatformFee: 0,
      freeDeliveriesUsedCount: 0,
      avgAcceptMinutes: null,
      avgDeliveryMinutes: null,
    };
  }

  return {
    requested: b.requested,
    completed: b.completed,
    cancelledOrReturned: b.cancelledOrReturned,
    totalDistance: Math.round(b.totalDistance * 10) / 10,
    totalRiderPayout: Math.round(b.totalRiderPayout * 100) / 100,
    totalPlatformFee: Math.round(b.totalPlatformFee * 100) / 100,
    freeDeliveriesUsedCount: b.freeDeliveriesUsedCount,
    avgAcceptMinutes: b.countAccepted > 0 ? Math.round((b.sumAcceptMinutes / b.countAccepted) * 10) / 10 : null,
    avgDeliveryMinutes:
      b.countDelivered > 0 ? Math.round((b.sumDeliveryMinutes / b.countDelivered) * 10) / 10 : null,
  };
}

export const getStoreDashboardStats = async (req, res) => {
  try {
    const storeId = req.user?.id;

    const store = await Store.findById(storeId).select('name active emailVerifiedAt freeDeliveriesRemaining');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

    // Lido à parte da agregação por período abaixo — é o estado ATUAL da
    // loja/plataforma, não algo que se soma por período.
    const platformSettings = await getOrCreateSettings();

    const now = new Date();
    const today = todayBrazilRange(now);
    const week = weekBrazilRange(now);
    const month = monthBrazilRange(now);
    const chartRange = lastNDaysBrazilRange(now, 30);

    const [result] = await Delivery.aggregate([
      { $match: { store: store._id } },
      {
        $facet: {
          now: [
            { $match: { status: { $in: [0, 1, 2, 3] } } },
            {
              $group: {
                _id: null,
                awaitingRider: { $sum: { $cond: [{ $eq: ['$status', 0] }, 1, 0] } },
                inProgress: { $sum: { $cond: [{ $in: ['$status', [1, 2, 3]] }, 1, 0] } },
              },
            },
          ],
          today: [{ $match: { createdAt: { $gte: today.start, $lte: today.end } } }, buildPeriodGroupStage()],
          week: [{ $match: { createdAt: { $gte: week.start, $lte: week.end } } }, buildPeriodGroupStage()],
          month: [{ $match: { createdAt: { $gte: month.start, $lte: month.end } } }, buildPeriodGroupStage()],
          chart: [
            { $match: { createdAt: { $gte: chartRange.start, $lte: chartRange.end } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Sao_Paulo' } },
                requested: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 4] }, 1, 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          topRiders: [
            {
              $match: {
                createdAt: { $gte: month.start, $lte: month.end },
                status: 4,
                rider: { $ne: null },
              },
            },
            { $group: { _id: '$rider', deliveries: { $sum: 1 } } },
            { $sort: { deliveries: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'riders', localField: '_id', foreignField: '_id', as: 'rider' } },
            { $unwind: '$rider' },
            {
              $project: {
                _id: 0,
                riderId: '$rider._id',
                name: '$rider.name',
                avatar: '$rider.avatar',
                deliveries: 1,
              },
            },
          ],
          categoryBreakdown: [
            { $match: { createdAt: { $gte: month.start, $lte: month.end } } },
            { $group: { _id: '$package.category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, category: '$_id', count: 1 } },
          ],
        },
      },
    ]);

    return res.status(200).json({
      now: {
        awaitingRider: result?.now?.[0]?.awaitingRider ?? 0,
        inProgress: result?.now?.[0]?.inProgress ?? 0,
      },
      // Estado atual, não período: quanto a plataforma cobra por entrega
      // concluída agora e quantas entregas grátis ainda restam pra essa
      // loja. Os totais de taxa cobrada POR PERÍODO estão dentro de
      // today/week/month (totalPlatformFee, freeDeliveriesUsedCount).
      billing: {
        deliveryFee: platformSettings.deliveryFee,
        freeDeliveriesRemaining: store.freeDeliveriesRemaining,
      },
      today: pickPeriodStats(result?.today),
      week: pickPeriodStats(result?.week),
      month: pickPeriodStats(result?.month),
      chart: result?.chart ?? [],
      topRiders: result?.topRiders ?? [],
      categoryBreakdown: result?.categoryBreakdown ?? [],
    });
  } catch (error) {
    console.error('Erro no getStoreDashboardStats:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /stores/deliveries/recent
// Últimas N entregas da loja autenticada, QUALQUER status (diferente de
// listStoreActiveDeliveries, que só traz as em andamento, e
// listStoreDeliveryHistory, que só traz as finalizadas) — é o feed de
// "atividade recente" do dashboard, então precisa misturar os dois
// mundos. Aceita ?limit= (padrão 10, máximo 50).
export const listStoreRecentDeliveries = async (req, res) => {
  try {
    const storeId = req.user?.id;

    const store = await Store.findById(storeId).select('name active emailVerifiedAt');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

    const deliveries = await Delivery.find({ store: storeId })
      .populate('rider', 'name phone avatar vehicle rating')
      .sort({ updatedAt: -1 })
      .limit(limit);

    return res.status(200).json(deliveries);
  } catch (error) {
    console.error('Erro no listStoreRecentDeliveries:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /stores/deliveries/active
// Lista as entregas da loja autenticada que ainda estão em andamento
// (status 0, 1, 2 ou 3 — solicitada, aceita, retirada ou a caminho), para
// a loja acompanhar o que falta ser concluído. Entregas em estado final
// (entregue, devolvida, cancelada) não aparecem aqui — ver
// listStoreDeliveryHistory para isso.
export const listStoreActiveDeliveries = async (req, res) => {
  try {
    const storeId = req.user?.id;

    const store = await Store.findById(storeId).select('name active emailVerifiedAt');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

    const deliveries = await Delivery.find({ store: storeId, status: { $in: [0, 1, 2, 3] } })
      .populate('rider', 'name phone avatar vehicle rating')
      .sort({ createdAt: -1 });

    return res.status(200).json(deliveries);
  } catch (error) {
    console.error('Erro no listStoreActiveDeliveries:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// Códigos de status por trás dos filtros de histórico (delivered/returned/cancelled)
const HISTORY_STATUS_CODES = {
  delivered: 4,
  returned: 5,
  cancelled: 6,
};

// Helper comum aos dois endpoints de histórico (loja e rider) — a única
// diferença entre eles é por qual campo filtrar (store vs rider) e o que
// popular (rider vs store) no resultado; toda a lógica de status/período/
// paginação é idêntica, então fica centralizada aqui. As validações de
// dono (loja ativa/verificada, rider elegível) continuam em cada endpoint
// específico, chamadas antes desta função — aqui já assumimos que passou.
//
// IMPORTANTE: cada endpoint específico (listStoreDeliveryHistory,
// listRiderDeliveryHistory) precisa ter sua própria validação ANTES de
// chegar aqui. Centralizar isso evita duplicar — e voltar a ter que
// corrigir duas vezes — a lógica de filtro por período/paginação (já
// corrigimos bugs de fuso horário e de tipos aqui uma vez; não vale a pena
// arriscar divergir as duas cópias).

async function findDeliveryHistory(req, { ownerField, ownerId, populateField, populateSelect }) {
  // Lemos os valores já validados/sanitizados via matchedData — NÃO de
  // req.query diretamente. No Express 5, req.query é um getter que
  // reparseia a URL a cada acesso, então as sanitizações do
  // express-validator (toDate/toInt/customSanitizer) nunca chegam a
  // req.query; matchedData(req) é a forma correta de pegar os valores já
  // convertidos (ver historyQueryValidator).
  const { status, from, to, page = 1, limit = 20 } = matchedData(req, { locations: ['query'] });

  if (from && to && to < from) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Dados inválidos',
          details: [{ field: 'to', message: 'Data final não pode ser anterior à data inicial' }],
        },
      },
    };
  }

  const filter = {
    [ownerField]: ownerId,
    status: status ? HISTORY_STATUS_CODES[status] : { $in: Object.values(HISTORY_STATUS_CODES) },
  };

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const skip = (page - 1) * limit;

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate(populateField, populateSelect)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Delivery.countDocuments(filter),
  ]);

  return {
    body: {
      data: deliveries,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}


// GET /stores/deliveries/history
// Lista as entregas da loja autenticada que já chegaram a um estado final
// (entregue, devolvida ou cancelada pela loja) — o espelho de
// listStoreActiveDeliveries, mas para o que já aconteceu. Como esse
// conjunto só cresce com o tempo, é sempre paginado e aceita filtros por
// status e por período (createdAt, ancorado no dia civil de Brasília — ver
// historyQueryValidator).
//
// Query params (todos opcionais):
//   status: 'delivered' | 'returned' | 'cancelled' — default: todos os 3
//   from, to: datas (AAAA-MM-DD) que delimitam createdAt
//   page: página, começando em 1 (default 1)
//   limit: itens por página, 1-100 (default 20)
export const listStoreDeliveryHistory = async (req, res) => {
  try {
    const storeId = req.user?.id;

    const store = await Store.findById(storeId).select('name active emailVerifiedAt');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

    const result = await findDeliveryHistory(req, {
      ownerField: 'store',
      ownerId: storeId,
      populateField: 'rider',
      populateSelect: 'name phone avatar vehicle rating',
    });

    if (result.error) {
      return res.status(result.error.status).json(result.error.body);
    }

    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Erro no listStoreDeliveryHistory:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

// GET /riders/deliveries/history
// Lista as entregas do rider autenticado que já chegaram a um estado final:
// entregue (4), devolvida por ele (5), ou cancelada pela loja (6) DEPOIS
// que ele já tinha aceitado (a loja pode cancelar até o status 1 — ver
// cancelDeliveryByStore — e o campo rider é mantido nesse caso justamente
// como registro de quem tinha aceitado). Mesmos filtros de
// status/período/paginação do histórico da loja.
//
// Não inclui entregas que o PRÓPRIO rider cancelou antes da retirada: essa
// transição (ver cancelDeliveryByRider) devolve a entrega ao pool com
// rider: null, então ela deixa de estar associada a este rider no banco —
// não há como listá-la aqui sem reconstruir a partir do array `events`, o
// que fica fora do escopo deste endpoint por ora.
export const listRiderDeliveryHistory = async (req, res) => {
  try {
    const riderId = req.user?.id;

    const { rider, error, status } = await findEligibleRider(riderId);
    if (!rider) {
      return res.status(status).json({ error });
    }

    const result = await findDeliveryHistory(req, {
      ownerField: 'rider',
      ownerId: riderId,
      populateField: 'store',
      populateSelect: 'name avatar address.district',
    });

    if (result.error) {
      return res.status(result.error.status).json(result.error.body);
    }

    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Erro no listRiderDeliveryHistory:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};


// POST /stores/deliveries/:id/cancel
// status 0 ou 1 (ainda sem pacote retirado) → 6, cancelada pela loja.
// Depois que o rider já retirou o pacote (status 2+), a loja não pode mais
// cancelar por aqui — nesse ponto quem decide é o rider (/return).
export const cancelDeliveryByStore = async (req, res) => {
  try {
    const storeId = req.user?.id;
    const { id } = req.params;
    const { motivo } = req.body;

    const store = await Store.findById(storeId).select('name active emailVerifiedAt');

    if (!store) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (!store.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    if (!store.emailVerifiedAt) {
      return res.status(403).json({ error: 'Conta ainda não verificada.' });
    }

        const delivery = await Delivery.findOneAndUpdate(
      { _id: id, store: storeId, status: { $in: [0, 1] } },
      {
        status: 6,
        cancelReason: motivo,
        // Mantemos o rider gravado (se havia um) como registro histórico de
        // quem tinha aceitado quando a loja cancelou — não zeramos aqui.
        $push: { events: { data: new Date(), descricao: `Entrega cancelada pela loja: ${motivo}` } },
      },
      { returnDocument: 'after' },
    );

    if (!delivery) {
      // Mesmo raciocínio do transitionAsRider: só investiga o motivo exato
      // da falha aqui no caminho de erro, sem comprometer a atomicidade do
      // update acima.
      const existing = await Delivery.findById(id).select('store status');

      if (!existing) {
        return res.status(404).json({ error: 'Entrega não encontrada.' });
      }

      if (existing.store.toString() !== storeId) {
        return res.status(403).json({ error: 'Você não tem permissão para cancelar esta entrega.' });
      }

      return res.status(409).json({ error: 'Não foi possível cancelar esta entrega.' });
    }

    // Se o rider já tinha aceitado (status era 1, e por isso o campo rider
    // segue preenchido no documento retornado acima), avisa ele que a loja
    // cancelou. Mesmo raciocínio de "best-effort, não bloqueia a resposta"
    // do createDelivery.
    if (delivery.rider) {
      notifyRiderDeliveryCancelled(delivery.rider, delivery).catch((error) => {
        console.error('Erro ao notificar rider sobre cancelamento pela loja:', error);
      });
    }

    return res.status(200).json(delivery);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    console.error('Erro no cancelDeliveryByStore:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};