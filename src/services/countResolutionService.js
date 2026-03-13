function toNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function countOccurrences(values) {
  const map = new Map()

  values.forEach((value) => {
    if (value === null || value === undefined) return
    const key = String(value)
    map.set(key, (map.get(key) || 0) + 1)
  })

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

function resolveItem(item, phaseToAnalyze) {
  const sistema = toNumber(item.quantidade_sistema) ?? 0
  const q1 = toNumber(item.q1)
  const q2 = toNumber(item.q2)
  const q3 = toNumber(item.q3)

  // fase 1: só resolve se bater no sistema
  if (phaseToAnalyze === 1) {
    if (q1 !== null && q1 === sistema) {
      return {
        resolved: true,
        finalQuantity: sistema,
        criterion: "saldo_sistema",
        needsNextRecount: false
      }
    }

    return {
      resolved: false,
      finalQuantity: null,
      criterion: null,
      needsNextRecount: true
    }
  }

  // fase 2: resolve se bater no sistema OU repetir 2x
  if (phaseToAnalyze === 2) {
    if (q2 !== null && q2 === sistema) {
      return {
        resolved: true,
        finalQuantity: sistema,
        criterion: "saldo_sistema",
        needsNextRecount: false
      }
    }

    if (q1 !== null && q2 !== null && q1 === q2) {
      return {
        resolved: true,
        finalQuantity: q1,
        criterion: "repeticao_2x",
        needsNextRecount: false
      }
    }

    return {
      resolved: false,
      finalQuantity: null,
      criterion: null,
      needsNextRecount: true
    }
  }

  // fase 3: resolve se qualquer uma bater no sistema OU qualquer quantidade repetir 2x
  if (phaseToAnalyze >= 3) {
    const counts = [q1, q2, q3]

    const matchedSystem = counts.find((value) => value !== null && value === sistema)
    if (matchedSystem !== undefined) {
      return {
        resolved: true,
        finalQuantity: sistema,
        criterion: "saldo_sistema",
        needsNextRecount: false
      }
    }

    const repeatedQuantity = getRepeatedQuantity(counts)
    if (repeatedQuantity !== null) {
      return {
        resolved: true,
        finalQuantity: repeatedQuantity,
        criterion: "repeticao_2x",
        needsNextRecount: false
      }
    }

    return {
      resolved: false,
      finalQuantity: null,
      criterion: "sem_consenso",
      needsNextRecount: false
    }
  }

  return {
    resolved: false,
    finalQuantity: null,
    criterion: null,
    needsNextRecount: false
  }
}

module.exports = {
  resolveItem
}