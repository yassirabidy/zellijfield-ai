abi <abi/4.0>,
include <tunables/global>

profile zellijfield-ai /opt/Zellijfield\ AI/zellijfield-ai flags=(unconfined) {
  userns,
  include if exists <local/zellijfield-ai>
}
