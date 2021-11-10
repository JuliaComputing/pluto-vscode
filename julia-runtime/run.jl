####
@info "COMMAND LINE ARGUMENTS"

asset_output_dir, vscode_proxy_root_raw, port_str, secret, pluto_launch_params = if isempty(ARGS)
	@warn "No arguments given, using development defaults!"
	mktempdir(cleanup=false), "", "4653", "asdf", "{}"
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
using Base64
import Pkg
Pkg.instantiate()

import JSON
using Suppressor

import Pluto

pluto_server_options = Pluto.Configuration.from_flat_kwargs(;
	port=port,
	launch_browser=false,
	# show_file_system=false,
	dismiss_update_notification=true,
	auto_reload_from_file=true,
	(Symbol(k) => v for (k, v) in JSON.parse(pluto_launch_params))...,
	
)
pluto_server_session = Pluto.ServerSession(;
	secret=secret,
	options=pluto_server_options,
)


###
@info "OPEN NOTEBOOK"





####

function generate_output(nb::Pluto.Notebook, filename::String, frontend_params::Dict=Dict())
	@info "GENERATING HTML FOR BESPOKE EDITOR" string(nb.notebook_id)
	new_editor_contents = Pluto.generate_html(;
		pluto_cdn_root = vscode_proxy_root,
		binder_url_js = "undefined",
		notebook_id_js = repr(string(nb.notebook_id)),
		disable_ui = false,
		(Symbol(k) => v for (k, v) in frontend_params)...,
	)
	write(joinpath(asset_output_dir, filename), new_editor_contents)

	@info "Bespoke editor created" filename
end


copy_assets() = cp(Pluto.project_relative_path("frontend"), asset_output_dir; force=true)

copy_assets()


try
import BetterFileWatching
@async try
	BetterFileWatching.watch_folder(Pluto.project_relative_path("frontend")) do event
		@info "Pluto asset changed!"
		copy_assets()
	end
catch e
	showerror(stderr, e, catch_backtrace())
end
@info "Watching Pluto folder for changes!"
catch end


filenbmap = Dict()

command_task = Pluto.@asynclog while true
	
	new_command_str_raw = readuntil(stdin, '\0')
	new_command_str = strip(new_command_str_raw, ['\0'])
	new_command = JSON.parse(new_command_str)
	
	@info "New command received!" new_command
	
	type = get(new_command, "type", "")
	detail = get(new_command, "detail", Dict())
	
	if type == "new"
		editor_html_filename = detail["editor_html_filename"]
		nb = Pluto.SessionActions.new(pluto_server_session)
		
		generate_output(nb, editor_html_filename)
	elseif type == "open"
		editor_html_filename = detail["editor_html_filename"]
		open(detail["jlfile"], "w") do f
			write(f, detail["text"])
		end
		nb = Pluto.SessionActions.open(pluto_server_session, detail["jlfile"])
		filenbmap[detail["jlfile"]] = nb
		generate_output(nb, editor_html_filename)
	else
		@error "Message of this type not recognised. " type
	end
	
end

#=
Watch the folder where pluto stores the files and emit
messages to the VSCode extension (stderr, file update event)
so the (possibly remote) VSCode knows that the files changed.
Only watch 'Modified' event.
=#
@async try
	BetterFileWatching.watch_folder(".") do event
		@info "Pluto files changed!" event
		paths = event.paths
		!(event isa BetterFileWatching.Modified) && return nothing
		length(paths) !== 1 && return nothing
		path = replace(paths[1], "/./" => "/")
		matchingpair = filter(collect(filenbmap)) do (filename, notebook)
			occursin(filename, path)
		end
		length(matchingpair) === 0 && return nothing
		nb = matchingpair[1][2]
		io = IOBuffer()
		io64 = Base64EncodePipe(io)
		Pluto.save_notebook(io64, nb)
		close(io64)
		@info "File update event ## $(String(take!(io))) ###"
	end
catch e
	@info "Error occured in filewatching..."
	showerror(stderr, e, catch_backtrace())
end



####
@info "RUNNING PLUTO SERVER..."
@info "MESSAGE TO EXTENSION: READY FOR COMMANDS"

@suppress_out Pluto.run(pluto_server_session)

Base.throwto(command_task, InterruptException())