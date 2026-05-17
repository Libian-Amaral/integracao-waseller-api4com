// =====================================================================
//  Normalizacao de numeros de telefone brasileiros.
//
//  O WaSeller envia os numeros geralmente como "5511999999999" (so digitos).
//  A API4COM espera o formato E.164 com "+", ex: "+5511999999999".
//
//  Esta funcao recebe um numero em qualquer formato e devolve as duas
//  variacoes que a integracao usa. Se o numero nao parecer valido,
//  devolve null (e quem chamou decide o que fazer).
// =====================================================================

function apenasDigitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function normalizarTelefone(valor) {
  let d = apenasDigitos(valor);
  if (!d) return null;

  // Remove zeros a esquerda (ex: 0 na frente do DDD).
  d = d.replace(/^0+/, '');

  // Garante o codigo do pais (55 = Brasil).
  if (!d.startsWith('55')) {
    // Numero nacional puro: DDD (2) + telefone (8 ou 9) = 10 ou 11 digitos.
    if (d.length === 10 || d.length === 11) {
      d = '55' + d;
    } else {
      return null; // formato nao reconhecido
    }
  }

  // Depois do "55" esperamos 10 ou 11 digitos (DDD + numero).
  const nacional = d.slice(2);
  if (nacional.length < 10 || nacional.length > 11) {
    return null;
  }

  return {
    waId: d, // "5511999999999"  -> usado no WaSeller (userID / phone)
    e164: '+' + d, // "+5511999999999" -> usado na API4COM (campo phone)
  };
}

module.exports = { normalizarTelefone, apenasDigitos };
