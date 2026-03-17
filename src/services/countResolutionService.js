function toNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function countOccurrences(values) {
  const map = new Map()

  for (const value of values) {
    if (value === null || value === undefined) continue
    const key = String(value)
    map.set(key, (map.get(key) || 0) + 1)
  }

  return map
}

function getRepeatedQuantity(values) {
  const occurrences = countOccurrences(values)

  for (const [key, total] of occurrences.entries()) {
    if (total >= 2) {
      return Number(key)
    }
  }

  return null
}

/**
 * Resolve item considerando TODAS as fases até `upToPhase`
 * e não só a fase atual isolada.
 */
function resolveItemUpToPhase(item, upToPhase) {
  const sistema = toNumber(item.quantidade_sistema) ?? 0
  const q1 = toNumber(item.q1)
  const q2 = toNumber(item.q2)
  const q3 = toNumber(item.q3)

  const counts = []
  if (upToPhase >= 1) counts.push(q1)
  if (upToPhase >= 2) counts.push(q2)
  if (upToPhase >= 3) counts.push(q3)

  const matchedSystem = counts.find((value) => value !== null && value === sistema)
  if (matchedSystem !== undefined) {
    return {
      resolved: true,
      finalQuantity: sistema,
      criterion: "saldo_sistema"
    }
  }

  const repeatedQuantity = getRepeatedQuantity(counts)
  if (repeatedQuantity !== null) {
    return {
      resolved: true,
      finalQuantity: repeatedQuantity,
      criterion: "repeticao_2x"
    }
  }

  return {
    resolved: false,
    finalQuantity: null,
    criterion: null
  }
}

module.exports = {
  resolveItemUpToPhase
}