using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Data.Entities;

namespace ServiceProcesgids.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<ProcessEntity> Processes => Set<ProcessEntity>();
    public DbSet<LocalUserEntity> LocalUsers => Set<LocalUserEntity>();
    public DbSet<ProcessVersionEntity> ProcessVersions => Set<ProcessVersionEntity>();
    public DbSet<SuggestionEntity> Suggestions => Set<SuggestionEntity>();
    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();
    public DbSet<IsoProcessConfigEntity> IsoProcessConfigs => Set<IsoProcessConfigEntity>();
    public DbSet<StoredFileEntity> Files => Set<StoredFileEntity>();
    public DbSet<ImportJobEntity> ImportJobs => Set<ImportJobEntity>();
    public DbSet<AiRunEntity> AiRuns => Set<AiRunEntity>();
    public DbSet<AssuranceSettingsEntity> AssuranceSettings => Set<AssuranceSettingsEntity>();
    public DbSet<AssuranceQuestionnaireSessionEntity> AssuranceQuestionnaireSessions =>
        Set<AssuranceQuestionnaireSessionEntity>();
    public DbSet<AssuranceQuestionnaireAnswerEntity> AssuranceQuestionnaireAnswers =>
        Set<AssuranceQuestionnaireAnswerEntity>();
    public DbSet<AssuranceRunEntity> AssuranceRuns => Set<AssuranceRunEntity>();
    public DbSet<AssuranceFindingEntity> AssuranceFindings => Set<AssuranceFindingEntity>();
    public DbSet<AssuranceFrameworkDraftEntity> AssuranceFrameworkDrafts =>
        Set<AssuranceFrameworkDraftEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(
            new AssuranceFrameworkDraftEntityConfiguration());

        modelBuilder.Entity<AssuranceSettingsEntity>(entity =>
        {
            entity.ToTable("AssuranceSettings");
            entity.HasKey(settings => settings.TenantId);
            entity.Property(settings => settings.TenantId).HasMaxLength(120);
            entity.Property(settings => settings.ActiveFrameworkIdsJson).IsRequired();
            entity.Property(settings => settings.UpdatedBy).HasMaxLength(220).IsRequired();
            entity.Property(settings => settings.Revision).IsConcurrencyToken();
            entity.HasIndex(settings => settings.NextRunAtUtc);
        });

        modelBuilder.Entity<AssuranceQuestionnaireSessionEntity>(entity =>
        {
            entity.ToTable("AssuranceQuestionnaireSessions");
            entity.HasKey(session => session.SessionId);
            entity.Property(session => session.SessionId).HasMaxLength(32);
            entity.Property(session => session.TenantId).HasMaxLength(120).IsRequired();
            entity.Property(session => session.FrameworkId).HasMaxLength(80).IsRequired();
            entity.Property(session => session.CatalogVersion).HasMaxLength(120).IsRequired();
            entity.Property(session => session.Status).HasMaxLength(30).IsRequired();
            entity.Property(session => session.StartedByActorId).HasMaxLength(180).IsRequired();
            entity.Property(session => session.StartedByActorName).HasMaxLength(220).IsRequired();
            entity.Property(session => session.Revision).IsConcurrencyToken();
            entity.HasIndex(session => new
            {
                session.TenantId,
                session.FrameworkId,
                session.StartedAtUtc
            });
            entity.HasIndex(session => session.Status);
        });

        modelBuilder.Entity<AssuranceQuestionnaireAnswerEntity>(entity =>
        {
            entity.ToTable("AssuranceQuestionnaireAnswers");
            entity.HasKey(answer => answer.Id);
            entity.Property(answer => answer.Id).ValueGeneratedOnAdd();
            entity.Property(answer => answer.SessionId).HasMaxLength(32).IsRequired();
            entity.Property(answer => answer.QuestionId).HasMaxLength(80).IsRequired();
            entity.Property(answer => answer.Outcome).HasMaxLength(20).IsRequired();
            entity.Property(answer => answer.EvidenceReference).HasMaxLength(500);
            entity.Property(answer => answer.Motivation).HasMaxLength(2000);
            entity.Property(answer => answer.AnsweredByActorId).HasMaxLength(180).IsRequired();
            entity.Property(answer => answer.AnsweredByActorName).HasMaxLength(220).IsRequired();
            entity.Property(answer => answer.Revision).IsConcurrencyToken();
            entity.HasIndex(answer => new { answer.SessionId, answer.QuestionId }).IsUnique();
            entity.HasOne(answer => answer.Session)
                .WithMany(session => session.Answers)
                .HasForeignKey(answer => answer.SessionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AssuranceRunEntity>(entity =>
        {
            entity.ToTable("AssuranceRuns");
            entity.HasKey(run => run.Id);
            entity.Property(run => run.Id).ValueGeneratedOnAdd();
            entity.Property(run => run.RunId).HasMaxLength(32).IsRequired();
            entity.Property(run => run.TenantId).HasMaxLength(120).IsRequired();
            entity.Property(run => run.Trigger).HasMaxLength(30).IsRequired();
            entity.Property(run => run.ScheduleKey).HasMaxLength(180);
            entity.Property(run => run.Status).HasMaxLength(30).IsRequired();
            entity.Property(run => run.CatalogVersion).HasMaxLength(120).IsRequired();
            entity.Property(run => run.FrameworkIdsJson).IsRequired();
            entity.Property(run => run.StartedByActorId).HasMaxLength(180).IsRequired();
            entity.Property(run => run.StartedByActorName).HasMaxLength(220).IsRequired();
            entity.Property(run => run.ErrorCode).HasMaxLength(120);
            entity.Property(run => run.Revision).IsConcurrencyToken();
            entity.HasIndex(run => run.ScheduleKey).IsUnique();
            entity.HasIndex(run => new { run.TenantId, run.Id });
            entity.HasIndex(run => run.Status);
        });

        modelBuilder.Entity<AssuranceFindingEntity>(entity =>
        {
            entity.ToTable("AssuranceFindings");
            entity.HasKey(finding => finding.Id);
            entity.Property(finding => finding.Id).ValueGeneratedOnAdd();
            entity.Property(finding => finding.FindingId).HasMaxLength(80).IsRequired();
            entity.Property(finding => finding.RunId).HasMaxLength(32).IsRequired();
            entity.Property(finding => finding.FrameworkId).HasMaxLength(80);
            entity.Property(finding => finding.ProcessId).HasMaxLength(160);
            entity.Property(finding => finding.QuestionId).HasMaxLength(80);
            entity.Property(finding => finding.Type).HasMaxLength(80).IsRequired();
            entity.Property(finding => finding.Severity).HasMaxLength(20).IsRequired();
            entity.Property(finding => finding.Title).HasMaxLength(240).IsRequired();
            entity.Property(finding => finding.Message).HasMaxLength(2000).IsRequired();
            entity.HasIndex(finding => finding.FindingId).IsUnique();
            entity.HasIndex(finding => finding.RunId);
            entity.HasOne(finding => finding.Run)
                .WithMany(run => run.Findings)
                .HasPrincipalKey(run => run.RunId)
                .HasForeignKey(finding => finding.RunId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AiRunEntity>(entity =>
        {
            entity.ToTable("AiRuns");
            entity.HasKey(run => run.Id);
            entity.Property(run => run.Id).ValueGeneratedOnAdd();
            entity.Property(run => run.RunId).HasMaxLength(32).IsRequired();
            entity.Property(run => run.TenantId).HasMaxLength(120).IsRequired();
            entity.Property(run => run.Capability).HasMaxLength(80).IsRequired();
            entity.Property(run => run.ProcessId).HasMaxLength(160).IsRequired();
            entity.Property(run => run.ActorId).HasMaxLength(180).IsRequired();
            entity.Property(run => run.ActorName).HasMaxLength(220).IsRequired();
            entity.Property(run => run.Provider).HasMaxLength(80);
            entity.Property(run => run.Model).HasMaxLength(180);
            entity.Property(run => run.Status).HasMaxLength(40).IsRequired();
            entity.Property(run => run.ResultStatus).HasMaxLength(40);
            entity.Property(run => run.InputHash).HasMaxLength(80);
            entity.Property(run => run.OutputHash).HasMaxLength(80);
            entity.Property(run => run.ErrorCode).HasMaxLength(120);
            entity.Property(run => run.FeedbackDecision).HasMaxLength(20);
            entity.Property(run => run.FeedbackReason).HasMaxLength(500);
            entity.Property(run => run.ProposedChangeIdsJson).IsRequired();
            entity.Property(run => run.AcceptedChangeIdsJson).IsRequired();
            entity.Property(run => run.FeedbackByActorId).HasMaxLength(180);
            entity.Property(run => run.FeedbackByActorName).HasMaxLength(220);
            entity.Property(run => run.Revision).IsConcurrencyToken();
            entity.HasIndex(run => run.RunId).IsUnique();
            entity.HasIndex(run => new { run.TenantId, run.ProcessId, run.Id });
            entity.HasIndex(run => run.Status);
        });

        modelBuilder.Entity<AuditLogEntity>(entity =>
        {
            entity.ToTable("AuditLogs");
            entity.HasKey(log => log.Id);
            entity.Property(log => log.Action).HasMaxLength(120).IsRequired();
            entity.Property(log => log.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(log => log.EntityId).HasMaxLength(180).IsRequired();
            entity.Property(log => log.ActorId).HasMaxLength(180).IsRequired();
            entity.Property(log => log.ActorName).HasMaxLength(220).IsRequired();
            entity.HasIndex(log => log.EntityId);
            entity.HasIndex(log => log.CreatedAtUtc);
        });

        modelBuilder.Entity<LocalUserEntity>(entity =>
        {
            entity.ToTable("LocalUsers");
            entity.HasKey(user => user.Id);
            entity.Property(user => user.Id).HasMaxLength(120);
            entity.Property(user => user.UserName).HasMaxLength(120).IsRequired();
            entity.Property(user => user.NormalizedUserName).HasMaxLength(120).IsRequired();
            entity.Property(user => user.DisplayName).HasMaxLength(180).IsRequired();
            entity.Property(user => user.Email).HasMaxLength(260);
            entity.Property(user => user.PasswordHash).HasMaxLength(260).IsRequired();
            entity.Property(user => user.RolesJson).IsRequired();
            entity.HasIndex(user => user.NormalizedUserName).IsUnique();
        });

        modelBuilder.Entity<IsoProcessConfigEntity>(entity =>
        {
            entity.ToTable("IsoProcessConfigs");
            entity.HasKey(config => config.ProcessId);
            entity.Property(config => config.ProcessId).HasMaxLength(160);
            entity.Property(config => config.ConfigJson).IsRequired();
            entity.Property(config => config.UpdatedBy).HasMaxLength(220).IsRequired();
            entity.HasIndex(config => config.UpdatedAtUtc);
        });

        modelBuilder.Entity<StoredFileEntity>(entity =>
        {
            entity.ToTable("Files");
            entity.HasKey(file => file.Id);
            entity.Property(file => file.Id).HasMaxLength(120);
            entity.Property(file => file.FileName).HasMaxLength(260).IsRequired();
            entity.Property(file => file.ContentType).HasMaxLength(120).IsRequired();
            entity.Property(file => file.Content).IsRequired();
            entity.HasIndex(file => file.CreatedAtUtc);
        });

        modelBuilder.Entity<ImportJobEntity>(entity =>
        {
            entity.ToTable("ImportJobs");
            entity.HasKey(job => job.Id);
            entity.Property(job => job.Id).HasMaxLength(120);
            entity.Property(job => job.FileName).HasMaxLength(260).IsRequired();
            entity.Property(job => job.Status).HasMaxLength(40).IsRequired();
            entity.Property(job => job.SourceFileId).HasMaxLength(120);
            entity.Property(job => job.ConfidenceJson).IsRequired();
            entity.Property(job => job.PageImagesJson).IsRequired();
            entity.HasIndex(job => job.Status);
            entity.HasIndex(job => job.CreatedAtUtc);
        });

        modelBuilder.Entity<ProcessVersionEntity>(entity =>
        {
            entity.ToTable("ProcessVersions");
            entity.HasKey(version => new { version.ProcessId, version.VersionNr });
            entity.Property(version => version.ProcessId).HasMaxLength(160);
            entity.Property(version => version.Status).HasMaxLength(40).IsRequired();
            entity.Property(version => version.ChangedBy).HasMaxLength(220).IsRequired();
            entity.Property(version => version.Comment).HasMaxLength(1000);
            entity.Property(version => version.ProcessJson).IsRequired();
            entity.Property(version => version.ProcessVersion).HasMaxLength(80).IsRequired();
            entity.Property(version => version.ProcessedSuggestionsJson).IsRequired();
            entity.HasIndex(version => version.ProcessId);
            entity.HasIndex(version => version.ChangedAtUtc);
        });

        modelBuilder.Entity<ProcessEntity>(entity =>
        {
            entity.ToTable("Processes");
            entity.HasKey(process => process.Id);
            entity.Property(process => process.Id).HasMaxLength(160);
            entity.Property(process => process.Hoofdproces).HasMaxLength(220).IsRequired();
            entity.Property(process => process.Detailproces).HasMaxLength(320).IsRequired();
            entity.Property(process => process.Versie).HasMaxLength(80).IsRequired();
            entity.Property(process => process.Status).HasMaxLength(40).IsRequired();
            entity.Property(process => process.LaatsteWijziging).HasMaxLength(40).IsRequired();
            entity.Property(process => process.Revision).IsConcurrencyToken();
            entity.Property(process => process.DocumentJson).IsRequired();
            entity.HasIndex(process => process.Status);
            entity.HasIndex(process => process.Hoofdproces);
        });

        modelBuilder.Entity<SuggestionEntity>(entity =>
        {
            entity.ToTable("Suggestions");
            entity.HasKey(suggestion => suggestion.Id);
            entity.Property(suggestion => suggestion.Id).HasMaxLength(120);
            entity.Property(suggestion => suggestion.ProcessId).HasMaxLength(160).IsRequired();
            entity.Property(suggestion => suggestion.StepId).HasMaxLength(120);
            entity.Property(suggestion => suggestion.Type).HasMaxLength(40).IsRequired();
            entity.Property(suggestion => suggestion.Text).HasMaxLength(4000).IsRequired();
            entity.Property(suggestion => suggestion.CreatedBy).HasMaxLength(220).IsRequired();
            entity.Property(suggestion => suggestion.Status).HasMaxLength(40).IsRequired();
            entity.Property(suggestion => suggestion.ResolvedBy).HasMaxLength(220);
            entity.HasIndex(suggestion => suggestion.ProcessId);
            entity.HasIndex(suggestion => suggestion.Status);
        });
    }
}
