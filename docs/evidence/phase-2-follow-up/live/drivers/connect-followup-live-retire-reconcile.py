exec(open('/private/tmp/connect-followup-live-common.py').read())
store='live-push-retire'
status=run(['store','status',store]);record=run(['store','get',store])
# Retained same-direction refusal above resolved the stale retiring op but
# correctly refused pushing a Store already on destination. Explicit pull.
run(['store','pull',store]);after=run(['store','status',store]);run(['store','remove',store])
d=json.loads((EVID/'push-retire.json').read_text())
ledger['rows'].append({'id':'push-retire','kind':'push','phase':'retire','boundary_pass':d['debuggerHit'] and d['debuggerKilled'],'status':status,'record':record,'resolved_status':after,'retained_initial_recovery_refusal':'InvalidInput: store already on docker; check correctly refused duplicate push','cleanup':'Store removed after explicit pull'})
save()
