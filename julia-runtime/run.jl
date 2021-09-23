####
@info "COMMAND LINE ARGUMENTS"

asset_output_dir, vscode_proxy_root_raw, port_str, secret = if isempty(ARGS)
	@warn "No arguments given, using development defaults!"
	mktempdir(cleanup=false), "", "4653", "asdf"
else
	ARGS
end
port = parse(Int, port_str)
vscode_proxy_root = let s = vscode_proxy_root_raw
	if isempty(s) || endswith(s, "/")
		s
	else
		s * "/"
	end
end


####
@info "PLUTO SETUP"

import Pluto

pluto_server_options = Pluto.Configuration.from_flat_kwargs(;
	port=port,
	launch_browser=false,
)
pluto_server_session = Pluto.ServerSession(;
	secret=secret,
	options=pluto_server_options,
)

nb = Pluto.SessionActions.new(pluto_server_session)




####
@info "GENERATING HTML FOR BESPOKE EDITOR" string(nb.notebook_id)

function generate_output()
	new_editor_contents = Pluto.generate_html(;
		pluto_cdn_root = vscode_proxy_root,
		binder_url_js = "undefined",
		notebook_id_js = repr(string(nb.notebook_id)),
		disable_ui = false,
	)
	cp(Pluto.project_relative_path("frontend"), asset_output_dir; force=true)
	write(joinpath(asset_output_dir, "editor_bespoke.html"), new_editor_contents)

	@info "Bespoke editor created"
end

generate_output()


# try
import BetterFileWatching
@async try
	BetterFileWatching.watch_folder(Pluto.project_relative_path("frontend")) do event
		@info "Pluto asset changed!"
		generate_output()
	end
catch e
	showerror(stderr, e, catch_backtrace())
end
@info "Watching Pluto folder for changes!"
# catch end

####
@info "RUNNING PLUTO SERVER..."

Pluto.run(pluto_server_session)