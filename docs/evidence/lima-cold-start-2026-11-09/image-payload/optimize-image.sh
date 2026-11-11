set -eu
systemctl mask snapd.service snapd.socket snapd.seeded.service snapd.autoimport.service snapd.core-fixup.service snapd.recovery-chooser-trigger.service ModemManager.service apport.service udisks2.service
cat > /etc/cloud/cloud.cfg.d/99-layerfs-runtime.cfg <<'EOF'
datasource_list: [NoCloud]
cloud_config_modules:
  - timezone
  - runcmd
cloud_final_modules:
  - scripts_per_boot
  - scripts_user
  - final_message
EOF
cloud-init clean --logs --machine-id
rm -rf /layerfs/state
rm -f /etc/ssh/ssh_host_*
sync
