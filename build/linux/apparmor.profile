abi <abi/4.0>,
include <tunables/global>

profile reel-studio /opt/Reel\ Studio/reel-studio flags=(unconfined) {
  userns,
  include if exists <local/reel-studio>
}
