---
name: registro-proveedor
description: Reglas para llenar el registro de proveedor sin inventar datos, sin firmar y sin enviar.
---

# Registro como proveedor

Periferia IT Group recibe solicitudes de clientes para quedar registrado como proveedor. La información de la empresa ya está en el repositorio maestro y los soportes están en el índice. El trabajo repetido es transcribir esa información al formato de cada cliente.

El agente prepara. Una persona firma y una persona decide el envío.

## Bandeja de este reto

| Carpeta | Cliente | País | Formato |
| --- | --- | --- | --- |
| co-industrias-delta | Industrias Delta S.A.S. | CO | xlsx |
| ec-corp-andina | Corporación Andina de Servicios S.A. | EC | pdf |
| hn-agroexport-sula | Agroexport Sula S. de R.L. | HN | xlsx |
| pa-logistica-istmo | Logística del Istmo S.A. | PA | portal |

Si el caso no está en esa lista, la herramienta de lectura devuelve los nombres válidos. No inventes carpetas.

## Identificador tributario

| País | Nombre que usa el cliente |
| --- | --- |
| CO | NIT |
| EC | RUC |
| PE | RUC |
| PA | RUC |
| HN | RTN |

Periferia solo tiene NIT colombiano. Si el cliente es de otro país, el campo se llena con ese NIT y queda en `requiere_confirmacion` con la nota `identificador extranjero`.

Etiquetas ambiguas, como "Identificación tributaria" o "Número de identificación fiscal", también quedan en confirmación. Se propone el identificador del país del cliente: NIT, RUC o RTN.

## Qué se llena y qué no

El glosario traduce la etiqueta del cliente a una ruta del maestro (`razon_social`, `contacto_comercial.email`, `banco.numero_cuenta`). Una coincidencia exacta se llena. Si la confianza queda bajo 0.8, el campo pide confirmación y propone el valor, no lo inventa. Si no hay ruta, el campo es faltante.

Los datos bancarios se escriben en el formulario solo cuando la plantilla los pide. No entran al borrador de correo, al checklist ni a la bitácora. En la respuesta de la herramienta el número se reemplaza por un aviso y el valor real queda únicamente en el archivo del formulario.

El país, los ingresos y el resto de campos se copian tal como están en el maestro. No se traduce `CO` a "Colombia" ni se agrega la moneda si el glosario apunta solo al valor.

## Soportes y firma

Cada soporte exigido se compara con el índice. Si no está, es ausente. Si `vigencia_hasta` es anterior a la fecha de ejecución, es vencido. Si `vigencia_hasta` es null, no vence. Si la fecha de vigencia es hoy, sigue vigente.

`listo_para_firma` es no cuando falta un soporte, hay uno vencido o no se generó el formulario. Un campo faltante aparece en el checklist y no bloquea ese estado.

El paquete copia el formulario, los soportes que existan (también los vencidos, marcados), `checklist.md` y `borrador-correo.md`.

## Portal

El formato portal no se automatiza. La herramienta escribe `valores-portal.md` y el agente dice `formato no soportado`. Las credenciales no se piden, no se guardan y no se escriben en el prompt, el repositorio ni los logs. La persona inicia sesión y pulsa enviar.

## Confirmación

Estas frases, solas, confirman el envío simulado: `envía`, `confirmo`, `sí`, `sí, envía`. Una negación (`no envíes`, `todavía no`) no confirma. El envío simulado solo crea `ENVIO-SIMULADO.md`. No sale un correo.
